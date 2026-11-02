import { blockElementMap } from './extractor';

const HIGHLIGHT_CLASS_NAME = 'localvoice-active-highlight';
const HIGHLIGHT_STYLE_ID = 'localvoice-injected-styles';

const HIGHLIGHT_CSS = `
.${HIGHLIGHT_CLASS_NAME} {
  background-color: rgba(254, 240, 138, 0.55) !important;
  border-left: 4px solid #eab308 !important;
  border-radius: 4px !important;
  padding-left: 6px !important;
  transition: background-color 0.25s ease, border-color 0.25s ease !important;
  box-shadow: 0 0 12px rgba(234, 179, 8, 0.2) !important;
}

@media (prefers-color-scheme: dark) {
  .${HIGHLIGHT_CLASS_NAME} {
    background-color: rgba(161, 98, 7, 0.35) !important;
    border-left: 4px solid #facc15 !important;
    box-shadow: 0 0 12px rgba(250, 204, 21, 0.25) !important;
  }
}
`;

function ensureStylesInjected(): void {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;
  const styleEl = document.createElement('style');
  styleEl.id = HIGHLIGHT_STYLE_ID;
  styleEl.textContent = HIGHLIGHT_CSS;
  document.head.appendChild(styleEl);
}

export function highlightBlock(blockId: string, autoScroll: boolean = true): boolean {
  ensureStylesInjected();
  clearAllHighlights();

  let targetEl = blockElementMap.get(blockId);
  if (!targetEl || !targetEl.isConnected) {
    // Fallback: look up by attribute if DOM element was re-rendered
    targetEl = document.querySelector(`[data-localvoice-id="${blockId}"]`) as HTMLElement;
    if (targetEl) {
      blockElementMap.set(blockId, targetEl);
    }
  }

  if (!targetEl) {
    return false;
  }

  targetEl.classList.add(HIGHLIGHT_CLASS_NAME);

  if (autoScroll) {
    targetEl.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest'
    });
  }

  return true;
}

export function clearAllHighlights(): void {
  const activeEls = document.querySelectorAll(`.${HIGHLIGHT_CLASS_NAME}`);
  activeEls.forEach((el) => {
    el.classList.remove(HIGHLIGHT_CLASS_NAME);
  });
}

export function cleanupHighlighting(): void {
  clearAllHighlights();
  const styleEl = document.getElementById(HIGHLIGHT_STYLE_ID);
  if (styleEl) {
    styleEl.remove();
  }
}
