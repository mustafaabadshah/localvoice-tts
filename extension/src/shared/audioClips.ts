/**
 * Clip store: synthesised paragraphs kept as blobs in IndexedDB.
 *
 * The backend has its own cache, but a hit there still costs a POST, a JSON round trip and the
 * whole audio payload over the wire - and only while that engine process is alive. This store
 * lives in the extension origin instead, survives popup teardown, and is shared by every popup
 * and the service worker, so switching Kokoro -> Piper -> Kokoro and coming back to a paragraph
 * replays the audio the machine already produced instead of running the engine again. That
 * repeat synthesis is what the user experienced as "Synthesizing..." plus a wait every time
 * they changed engine or pressed Read Page again.
 *
 * The key is exactly what changes the audio: engine | voice | speed | text. Paragraph index,
 * tab and page are deliberately excluded - the same sentence in the same voice is the same
 * audio, wherever it was found. The store is bounded by an LRU budget so it can never grow
 * without limit, and every operation degrades to a miss instead of throwing: a broken cache
 * must never break playback.
 */

const DB_NAME = 'localvoice-audio';
const DB_VERSION = 1;
const STORE = 'clips';
/** Budget for cached audio (~10 minutes of Piper speech, ~30 Kokoro paragraphs). */
const MAX_BYTES = 120 * 1024 * 1024;

export interface ClipIdentity {
  engine: string;
  voiceId: string;
  speed: number;
}

interface ClipRecord extends ClipIdentity {
  key: string;
  blob: Blob;
  bytes: number;
  lastUsed: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('lastUsed', 'lastUsed');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * SHA-256 of the identity string. `crypto.subtle` needs a secure context, which
 * `chrome-extension://` pages are; the FNV fallback only exists so an exotic host cannot make
 * the cache throw, it is not a security boundary - the text length is mixed in so a collision
 * would need both a different length and a matching pair of hashes.
 */
async function digestHex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hash = await crypto.subtle.digest('SHA-256', data);
    return toHex(new Uint8Array(hash));
  }

  let h1 = 0x811c9dc5;
  let h2 = 0xc2b2ae35;
  for (let i = 0; i < data.length; i++) {
    h1 = Math.imul(h1 ^ data[i], 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ data[data.length - 1 - i], 0x85ebca6b) >>> 0;
  }
  return `fnv${data.length.toString(16)}${h1.toString(16)}${h2.toString(16)}`;
}

/** Stable cache key for one paragraph in one engine, voice and speed. */
export async function clipKey(identity: ClipIdentity, text: string): Promise<string> {
  return digestHex(`${identity.engine}|${identity.voiceId}|${identity.speed.toFixed(2)}|${text}`);
}

/** Returns the cached audio for `key`, or null. Touches the entry for LRU accounting. */
export async function getClip(key: string): Promise<Blob | null> {
  const db = await openDb();
  if (!db) return null;

  try {
    const record = await requestToPromise<ClipRecord | undefined>(
      db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
    );
    if (!record || !record.blob) return null;

    // Best effort: a failed touch only costs eviction ordering, never the clip itself.
    try {
      db.transaction(STORE, 'readwrite')
        .objectStore(STORE)
        .put({ ...record, lastUsed: Date.now() });
    } catch {
      // ignore
    }

    return record.blob;
  } catch {
    return null;
  }
}

/**
 * Stores `blob` for `key` and trims the oldest entries once the budget is exceeded.
 * Fire-and-forget from the callers: playback must not wait for, or fail on, a cache write.
 */
export async function putClip(key: string, blob: Blob, identity: ClipIdentity): Promise<void> {
  const db = await openDb();
  if (!db || blob.size === 0) return;

  try {
    const record: ClipRecord = {
      key,
      blob,
      bytes: blob.size,
      lastUsed: Date.now(),
      engine: identity.engine,
      voiceId: identity.voiceId,
      speed: identity.speed
    };
    await requestToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).put(record));
    await trim(db);
  } catch {
    // A cache write must never break a read.
  }
}

async function trim(db: IDBDatabase): Promise<void> {
  try {
    const records = await requestToPromise<ClipRecord[]>(
      db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
    );

    let total = records.reduce((sum, record) => sum + (record.bytes || 0), 0);
    if (total <= MAX_BYTES) return;

    records.sort((a, b) => a.lastUsed - b.lastUsed);
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
    for (const record of records) {
      if (total <= MAX_BYTES) break;
      total -= record.bytes || 0;
      store.delete(record.key);
    }
  } catch {
    // ignore
  }
}

/** Drops every cached paragraph. Backend and client caches are cleared together. */
export async function clearClips(): Promise<void> {
  const db = await openDb();
  if (!db) return;

  try {
    await requestToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).clear());
  } catch {
    // ignore
  }
}

/** Total entries and bytes currently cached - used for diagnostics only. */
export async function clipStats(): Promise<{ count: number; bytes: number }> {
  const db = await openDb();
  if (!db) return { count: 0, bytes: 0 };

  try {
    const records = await requestToPromise<ClipRecord[]>(
      db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
    );
    return {
      count: records.length,
      bytes: records.reduce((sum, record) => sum + (record.bytes || 0), 0)
    };
  } catch {
    return { count: 0, bytes: 0 };
  }
}
