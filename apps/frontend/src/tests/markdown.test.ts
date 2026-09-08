import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '@/markdown';

describe('markdown & safety pipeline (§6.6)', () => {
  it('renders GFM paragraphs with serif prose container', () => {
    const html = renderMarkdown('Hello **world**.');
    expect(html).toContain('<strong>world</strong>');
  });

  it('renders GFM tables and strikethrough', () => {
    const html = renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |\n\n~~gone~~');
    expect(html).toContain('<table>');
    expect(html).toContain('<del>gone</del>');
  });

  it('strips script tags, event handlers and javascript: URIs (XSS corpus)', () => {
    const html = renderMarkdown(
      [
        'Hello <script>alert(1)</script> world',
        '<img src="x" onerror="alert(1)">',
        '[click me](javascript:alert(1))',
        '<iframe src="https://evil.example"></iframe>',
      ].join('\n\n'),
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<iframe');
  });

  it('keeps HTML inside code fences escaped (no nested HTML execution)', () => {
    const html = renderMarkdown('```\n<script>alert(1)</script>\n```');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert');
  });

  it('only allows /media/ or base64 data images', () => {
    const ok = renderMarkdown('![a](/media/x.png)');
    expect(ok).toContain('/media/x.png');
    const data = renderMarkdown('![b](data:image/png;base64,AAAA)');
    expect(data).toContain('data:image/png;base64');
    const evil = renderMarkdown('![c](https://tracker.example/pixel.png)');
    expect(evil).not.toContain('tracker.example');
  });

  it('classifies quote-initial paragraphs as dialogue', () => {
    const html = renderMarkdown('"You should not have come here," she said.');
    expect(html).toContain('lk-dialogue');
  });

  it('classifies em-wrapped asterisk paragraphs as narration', () => {
    const html = renderMarkdown('*Rain lashed against the windows.*');
    expect(html).toContain('lk-narration');
  });

  it('renders fenced code with a highlighted copy block', () => {
    const html = renderMarkdown('```js\nconst x = 1;\n```');
    expect(html).toContain('lk-code');
    expect(html).toContain('lk-code-copy');
    expect(html).toContain('hljs');
  });

  it('opens links in new tabs safely', () => {
    const html = renderMarkdown('[docs](https://example.com)');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
