import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { marked } from 'marked';

// ---------------------------------------------------------------------------
// Settled-message markdown pipeline (plan §6.6):
//   marked (GFM) → custom renderer (highlight.js code, safe links) →
//   DOMPurify.sanitize → DOM classification (dialogue / narration styling).
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    code(token) {
      const text = typeof token.text === 'string' ? token.text : '';
      const lang = typeof token.lang === 'string' ? token.lang.trim() : '';
      const language = lang !== '' && hljs.getLanguage(lang) ? lang : '';
      const highlighted =
        language !== '' ? hljs.highlight(text, { language }).value : escapeHtml(text);
      const label = language !== '' ? escapeHtml(language) : 'text';
      return `<div class="lk-code"><div class="lk-code-bar"><span>${label}</span><button type="button" class="lk-code-copy">Copy code</button></div><pre><code class="hljs language-${language}">${highlighted}</code></pre></div>`;
    },
    link(token) {
      const href = typeof token.href === 'string' ? token.href : '#';
      const title =
        typeof token.title === 'string' && token.title !== ''
          ? ` title="${escapeHtml(token.title)}"`
          : '';
      const label = this.parser.parseInline(token.tokens ?? []);
      return `<a href="${escapeHtml(href)}"${title} target="_blank" rel="noopener noreferrer">${label}</a>`;
    },
  },
});

const IMAGE_DATA_PATTERN = /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,/i;

function isAllowedImageSrc(src: string): boolean {
  return src.startsWith('/media/') || IMAGE_DATA_PATTERN.test(src);
}

/**
 * Post-sanitize pass: images may only come from `/media/*` or data URLs the
 * app itself renders; top-level paragraphs are classified for the literary
 * styles — lines starting with a speech quote → `lk-dialogue`, em-wrapped
 * `*narration*` → `lk-narration` (A5: presentation-only).
 */
function classifyAndFilter(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? '';
    if (!isAllowedImageSrc(src)) img.remove();
  }
  for (const element of Array.from(doc.body.children)) {
    if (element.tagName !== 'P') continue;
    const text = (element.textContent ?? '').trimStart();
    if (/^["“”‘’]/.test(text)) element.classList.add('lk-dialogue');
    else if (element.firstElementChild?.tagName === 'EM') element.classList.add('lk-narration');
  }
  return doc.body.innerHTML;
}

const FORBID_TAGS = [
  'iframe',
  'style',
  'form',
  'input',
  'textarea',
  'select',
  'embed',
  'object',
  'base',
  'meta',
  'link',
];

/** Renders a settled message to sanitized, classified HTML. */
export function renderMarkdown(source: string): string {
  const raw = marked.parse(source, { async: false });
  const clean = DOMPurify.sanitize(raw, {
    FORBID_TAGS,
    FORBID_ATTR: ['style', 'srcset', 'onerror', 'onload'],
    ADD_ATTR: ['target'],
  });
  return classifyAndFilter(clean);
}
