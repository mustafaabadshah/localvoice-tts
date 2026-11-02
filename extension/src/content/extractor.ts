import { ExtractionResult, TextBlock, BlockType } from '../shared/types';

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
  blockElementMap.clear();

  const title = document.title || 'Untitled Webpage';
  const url = window.location.href;
  const blocks: TextBlock[] = [];
  const seenTexts = new Set<string>();
  let orderIndex = 0;

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
        if (!isVisible(bodyEl)) continue;

        // Try to get child paragraphs or div blocks inside the email
        const innerParas = Array.from(
          bodyEl.querySelectorAll('p, div[dir="ltr"], div:not(:has(div)), li')
        ) as HTMLElement[];

        if (innerParas.length > 0) {
          for (const p of innerParas) {
            if (isVisible(p) && !shouldSkipElement(p)) {
              addBlock(p, 'paragraph', p.innerText);
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
      return { pageTitle: title, pageUrl: url, blocks };
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
      if (!isVisible(el) || shouldSkipElement(el)) continue;

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
    const textContainers = Array.from(
      document.querySelectorAll('div, section, span[dir="ltr"]')
    ) as HTMLElement[];

    for (const el of textContainers) {
      if (!isVisible(el) || shouldSkipElement(el)) continue;

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

  return {
    pageTitle: title,
    pageUrl: url,
    blocks
  };
}

export function extractSelectedContent(): ExtractionResult {
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

  return {
    pageTitle: title,
    pageUrl: url,
    blocks
  };
}
