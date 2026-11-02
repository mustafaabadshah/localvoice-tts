# LocalVoice V2 — Universal Webpage Extraction & DOM Strategy

## 1. Overview & Architecture

Webpages across the modern internet vary dramatically in structure: from semantic HTML5 news articles (`<article>`, `<p>`), to complex Single Page Applications (SPAs like React, Vue, Angular), and intricate dynamic productivity applications like **Google Gmail**.

LocalVoice V2 implements a robust, multi-tiered **Universal Webpage Extractor** that extracts clean, readable text blocks in natural reading order without ads, navigation chrome, or boilerplate noise.

---

## 2. Extraction Strategy Hierarchy

The content script evaluates four extraction tiers in descending priority order:

```
┌────────────────────────────────────────────────────────┐
│               User Selection Present?                  │
└───────────────────────────┬────────────────────────────┘
                            │
               YES ─────────┴───────── NO
                │                       │
                ▼                       ▼
   [Strategy 1: Selection]     Is Domain Gmail?
   Extract exact selected      (mail.google.com)
   text split by paragraphs             │
                               YES ─────┴───── NO
                                │               │
                                ▼               ▼
                     [Strategy 2: Gmail]   [Strategy 3: Semantic]
                     Target active email   Target <article>, <main>,
                     containers & sender   .post-content, #content
                                                │
                                    Blocks < 2? ─ NO ──► Deliver Blocks
                                                │
                                               YES
                                                ▼
                                    [Strategy 4: SPA Fallbacks]
                                    Leaf <div>/<span> elements
                                    without nested block children
```

### Strategy 1: User Selected Text (`user_selected_text`)
- **Trigger**: When the user has highlighted text on the page with their mouse cursor (`window.getSelection()`).
- **Mechanism**: Splits selected text on multi-newline boundaries (`\r?\n\s*\r?\n|\n`), creating readable paragraphs linked to the selection's parent container for inline highlighting.
- **Benefit**: Instant listening of any snippet, comment, or paragraph without reading the surrounding page.

### Strategy 2: Gmail Active Email View (`gmail_active_email`)
- **Trigger**: `window.location.hostname.includes("mail.google.com")`.
- **Target Containers**:
  - Email Subject: `h2.hP`, `[role="main"] h2`
  - Message Body: `div.a3s`, `div[data-message-id] .ii`, `.message-body`, `[role="listitem"] [dir="ltr"]`
- **Mechanism**:
  - Traverses active, visible email containers.
  - Queries paragraphs (`p`, `div[dir="ltr"]`, `li`, and leaf `div:not(:has(div))`).
  - Fallback: If an email uses raw HTML or `table`/`br` formatting without nested `p` tags, text is split on `\n+` boundaries.
  - Eliminates quote history, signature noise, and Gmail sidebar navigation.

### Strategy 3: Semantic Article Containers (`semantic_article_containers`)
- **Target Containers**: `article`, `main`, `[role="main"]`, `.post-content`, `.article-content`, `#content`, `.entry-content` (falls back to `document.body` if absent).
- **Target Tags**: `h1, h2, h3, h4, h5, h6, p, blockquote, li, dd`.
- **Noise Filtering**: Strictly discards non-content nodes matching:
  `nav, aside, script, style, noscript, svg, canvas, button, input, select, textarea, [role="navigation"], [role="banner"], [role="contentinfo"], [aria-hidden="true"], .site-nav, .navbar, .site-footer, .cookie-banner, .cookie-consent, .ad, .ad-banner, .advertisement`.
- **Visibility Gate**: Checks element computed styles (`display !== 'none'`, `visibility !== 'hidden'`, `opacity !== '0'`) and bounding rectangles (`width > 0 && height > 0`).

### Strategy 4: SPA Leaf Node Fallback (`spa_leaf_nodes`)
- **Trigger**: Activated automatically if Strategy 3 yields fewer than 2 paragraphs (typical in modern web apps where text is wrapped in generic nested `<div>` and `<span>` tags without `<p>` tags).
- **Mechanism**: Queries all `div`, `section`, and `span[dir="ltr"]` elements that have **no** nested block children (`div, p, h1-h6, article, section`) and whose normalized text contains at least 20 characters.

---

## 3. Investigation of Prior Gmail Extraction Failure

### Root Cause Analysis
In LocalVoice V1, opening Gmail resulted in the persistent error:
> *"Could not extract page text. Ensure the page is fully loaded."*

Upon auditing the original content script, two fatal flaws were discovered:
1. **Generic Semantic Search Only**: The original extractor only queried `article` or `main` tags. Gmail’s web client does not use standard HTML5 `<article>` or `<main>` elements for individual emails; emails are rendered inside virtualized lists (`div.a3s` and `div.ii`) with dynamic class hashes. Because no `<article>` was found, the query fell back to `document.body`, which then searched for `<p>` tags. Most HTML emails in Gmail use nested `<div>` tags with `dir="ltr"` or `<span>` line breaks rather than `<p>` tags, resulting in **zero** matching blocks.
2. **Brittle Content Script Lifecycle**: When navigating between tabs or refreshing dynamic single-page applications, re-injecting the content script caused `SyntaxError: Identifier 'u' has already been declared` because the bundled script was placed into the tab's global window scope. The content script crashed immediately, and the popup's message listener timed out with the generic "Could not extract page text" fallback.

### LocalVoice V2 Resolution
1. **Targeted Gmail Selectors**: Added domain detection and specialized extraction targeting `div.a3s` and `div[data-message-id] .ii`.
2. **IIFE Wrapping & Singleton Listener**: The entire content script is bundled as a self-contained Immediately Invoked Function Expression (`(() => { ... })();`) with a singleton check:
   ```javascript
   if (window.__LOCALVOICE_LISTENER__) {
     chrome.runtime.onMessage.removeListener(window.__LOCALVOICE_LISTENER__);
   }
   window.__LOCALVOICE_LISTENER__ = messageHandler;
   chrome.runtime.onMessage.addListener(messageHandler);
   ```
3. **Live Diagnostics Modal**: Users and developers can now click the diagnostic activity icon in the popup header to inspect exact DOM extraction metrics in real time.

---

## 4. Live Extraction Diagnostics

Every extraction payload returned by the content script includes comprehensive diagnostic metadata:

```typescript
interface ExtractionDiagnostics {
  pageTitle: string;        // Webpage title
  pageUrl: string;          // Current active tab URL
  readyState: string;       // Document readiness ('complete', 'interactive', 'loading')
  strategyUsed: string;     // 'user_selected_text' | 'gmail_active_email' | 'semantic_article_containers' | 'spa_leaf_nodes'
  totalBlocks: number;      // Total readable blocks extracted
  totalCharacters: number;  // Character count across all blocks
  totalWords: number;       // Word count across all blocks
  excludedCount: number;    // Number of noise elements evaluated and discarded
  durationMs: number;       // DOM traversal and extraction duration in milliseconds
  previewBlocks: string[];  // Text preview of the first 3 extracted blocks
}
```

The extension popup exposes this data via a dedicated **DOM Extraction Diagnostics** modal featuring a one-click **Copy Diagnostics** button for troubleshooting.
