import { ExtractionResult, TextBlock, BlockType, ExtractionDiagnostics } from '../shared/types';

// Map of block ID to live DOM element in the active page
export const blockElementMap = new Map<string, HTMLElement>();

const EXCLUDE_SELECTORS = [
  'nav',
  'aside',
  'script',
  'style',
  'noscript',
  'svg',
  'canvas',
  'button',
  'input',
  'select',
  'textarea',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[aria-hidden="true"]',
  '.site-nav',
  '.navbar',
  '.site-footer',
  '.cookie-banner',
  '.cookie-consent',
  '.ad',
  '.ad-banner',
  '.advertisement'
];

function isVisible(el: HTMLElement): boolean {
  if (el.hasAttribute('hidden')) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function shouldSkipElement(el: HTMLElement): boolean {
  for (const selector of EXCLUDE_SELECTORS) {
    if (el.closest(selector)) return true;
  }
  return false;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function extractArticleContent(): ExtractionResult {
  const startTime = performance.now();
  blockElementMap.clear();

  const title = document.title || 'Untitled Webpage';
  const url = window.location.href;
  const blocks: TextBlock[] = [];
  const seenTexts = new Set<string>();
  let orderIndex = 0;
  let excludedCount = 0;
  let strategyUsed = 'semantic_article_containers';

  const addBlock = (el: HTMLElement, type: BlockType, text: string): boolean => {
    const cleaned = cleanText(text);
    if (!cleaned || cleaned.length < 3 || seenTexts.has(cleaned)) return false;

    // Avoid duplicating parent container text if child was already captured
    for (const seen of seenTexts) {
      if (seen.length > 40 && seen.includes(cleaned)) {
        return false;
      }
    }

    const blockId = `localvoice-block-${orderIndex + 1}`;
    el.setAttribute('data-localvoice-id', blockId);
    blockElementMap.set(blockId, el);
    seenTexts.add(cleaned);

    blocks.push({
      id: blockId,
      type,
      text: cleaned,
      order: orderIndex,
      tagName: el.tagName.toLowerCase()
    });

    orderIndex++;
    return true;
  };

  // 1. Gmail-specific adaptive extraction
  const isGmail = window.location.hostname.includes('mail.google.com');
  if (isGmail) {
    strategyUsed = 'gmail_active_email';
    // Subject heading
    const subjectEl = document.querySelector('h2.hP, [role="main"] h2') as HTMLElement;
    if (subjectEl && isVisible(subjectEl)) {
      addBlock(subjectEl, 'heading', subjectEl.innerText);
    }

    // Email message bodies (.a3s is Gmail's email body wrapper)
    const emailBodies = Array.from(
      document.querySelectorAll('div.a3s, div[data-message-id] .ii, .message-body, [role="listitem"] [dir="ltr"]')
    ) as HTMLElement[];

    if (emailBodies.length > 0) {
      for (const bodyEl of emailBodies) {
        if (!isVisible(bodyEl)) {
          excludedCount++;
          continue;
        }

        const innerParas = Array.from(
          bodyEl.querySelectorAll('p, div[dir="ltr"], div:not(:has(div)), li')
        ) as HTMLElement[];

        if (innerParas.length > 0) {
          for (const p of innerParas) {
            if (isVisible(p) && !shouldSkipElement(p)) {
              addBlock(p, 'paragraph', p.innerText);
            } else {
              excludedCount++;
            }
          }
        } else {
          const lines = (bodyEl.innerText || '').split(/\n+/).map(cleanText).filter((l) => l.length > 3);
          for (const line of lines) {
            addBlock(bodyEl, 'paragraph', line);
          }
        }
      }
    }

    if (blocks.length > 0) {
      const durationMs = Math.round(performance.now() - startTime);
      const totalChars = blocks.reduce((acc, b) => acc + b.text.length, 0);
      const totalWords = blocks.reduce((acc, b) => acc + b.text.split(/\s+/).length, 0);

      const diagnostics: ExtractionDiagnostics = {
        pageTitle: title,
        pageUrl: url,
        readyState: document.readyState,
        strategyUsed,
        totalBlocks: blocks.length,
        totalCharacters: totalChars,
        totalWords,
        excludedCount,
        durationMs,
        previewBlocks: blocks.slice(0, 3).map((b) => b.text)
      };

      return { pageTitle: title, pageUrl: url, blocks, diagnostics };
    }
  }

  // 2. Standard Webpages: Search headings, paragraphs, lists, and blockquotes
  const mainContainers = Array.from(
    document.querySelectorAll('article, main, [role="main"], .post-content, .article-content, #content, .entry-content')
  ) as HTMLElement[];

  const searchRoots = mainContainers.length > 0 ? mainContainers : [document.body];

  for (const root of searchRoots) {
    const candidates = Array.from(
      root.querySelectorAll('h1, h2, h3, h4, h5, h6, p, blockquote, li, dd')
    ) as HTMLElement[];

    for (const el of candidates) {
      if (!isVisible(el) || shouldSkipElement(el)) {
        excludedCount++;
        continue;
      }

      const text = cleanText(el.innerText || '');
      if (!text || text.length < 3) continue;

      const tagName = el.tagName.toLowerCase();
      let type: BlockType = 'paragraph';
      if (tagName.startsWith('h')) {
        type = 'heading';
      } else if (tagName === 'li' || tagName === 'dd') {
        type = 'list_item';
      }

      addBlock(el, type, text);
    }
  }

  // 3. Fallback for SPAs / Modern Web Apps without standard <p> tags
  if (blocks.filter((b) => b.type === 'paragraph').length < 2) {
    strategyUsed = 'spa_leaf_nodes';
    const textContainers = Array.from(
      document.querySelectorAll('div, section, span[dir="ltr"]')
    ) as HTMLElement[];

    for (const el of textContainers) {
      if (!isVisible(el) || shouldSkipElement(el)) {
        excludedCount++;
        continue;
      }

      // Only inspect leaf or near-leaf elements (no child block tags)
      const hasBlockChildren = el.querySelector('p, div, h1, h2, h3, h4, h5, h6, article, section') !== null;
      if (!hasBlockChildren) {
        const text = cleanText(el.innerText || '');
        if (text.length >= 20) {
          addBlock(el, 'paragraph', text);
        }
      }
    }
  }

  const durationMs = Math.round(performance.now() - startTime);
  const totalChars = blocks.reduce((acc, b) => acc + b.text.length, 0);
  const totalWords = blocks.reduce((acc, b) => acc + b.text.split(/\s+/).length, 0);

  const diagnostics: ExtractionDiagnostics = {
    pageTitle: title,
    pageUrl: url,
    readyState: document.readyState,
    strategyUsed,
    totalBlocks: blocks.length,
    totalCharacters: totalChars,
    totalWords,
    excludedCount,
    durationMs,
    previewBlocks: blocks.slice(0, 3).map((b) => b.text)
  };

  return {
    pageTitle: title,
    pageUrl: url,
    blocks,
    diagnostics
  };
}

export function extractSelectedContent(): ExtractionResult {
  const startTime = performance.now();
  blockElementMap.clear();
  const selection = window.getSelection();
  const title = document.title || 'Untitled Webpage';
  const url = window.location.href;

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return { pageTitle: title, pageUrl: url, blocks: [] };
  }

  const selectedText = selection.toString().trim();
  if (!selectedText) {
    return { pageTitle: title, pageUrl: url, blocks: [] };
  }

  // Split selected text by paragraphs or line breaks
  const rawParagraphs = selectedText.split(/\r?\n\s*\r?\n|\n/);
  const paragraphs = rawParagraphs.map(cleanText).filter((p) => p.length > 1);
  const blocks: TextBlock[] = [];

  const anchorNode = selection.anchorNode;
  const container = (anchorNode?.nodeType === Node.ELEMENT_NODE ? anchorNode : anchorNode?.parentElement) as HTMLElement || document.body;

  paragraphs.forEach((pText, i) => {
    const blockId = `localvoice-select-${i + 1}`;
    blockElementMap.set(blockId, container);
    blocks.push({
      id: blockId,
      type: 'paragraph',
      text: pText,
      order: i
    });
  });

  const durationMs = Math.round(performance.now() - startTime);
  const totalChars = blocks.reduce((acc, b) => acc + b.text.length, 0);
  const totalWords = blocks.reduce((acc, b) => acc + b.text.split(/\s+/).length, 0);

  const diagnostics: ExtractionDiagnostics = {
    pageTitle: title,
    pageUrl: url,
    readyState: document.readyState,
    strategyUsed: 'user_selected_text',
    totalBlocks: blocks.length,
    totalCharacters: totalChars,
    totalWords,
    excludedCount: 0,
    durationMs,
    previewBlocks: blocks.slice(0, 3).map((b) => b.text)
  };

  return {
    pageTitle: title,
    pageUrl: url,
    blocks,
    diagnostics
  };
}
