// Builds docs/Project-Report.pdf from docs/REPORT.md (+ appendices) using marked and Edge's PDF printer.
// Mermaid diagrams in the markdown are rendered in the browser before printing.
//   npm run report
import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';
import { chromium } from 'playwright-core';

const EDGE = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const read = (f) => fs.readFileSync(f, 'utf8');

// the ER diagram lives in its own file; embed its mermaid block where REPORT.md says {{ER_DIAGRAM}}
const er = read('docs/ER-diagram.md');
const mermaidBlock = er.match(/```mermaid[\s\S]*?```/)[0];
const erTail = er.slice(er.indexOf('### Cardinality notes'));

let md = read('docs/REPORT.md')
  .replace('{{ER_DIAGRAM}}', mermaidBlock + '\n\n' + erTail)
  .replace('{{DATA_DICTIONARY}}', read('docs/data-dictionary.md').replace(/^# Data Dictionary\s*/, '').replace(/^_Generated.*$/m, ''))
  .replace('{{SCHEMA_REFERENCE}}', read('docs/schema-reference.md').replace(/^# .*\n/, ''))
  .replace('{{BENCHMARKS}}', fs.existsSync('docs/benchmark-results.md') ? read('docs/benchmark-results.md').replace(/^# .*\n/, '') : '_not run_');

// inline screenshots as data URIs so the PDF is self-contained
md = md.replace(/!\[([^\]]*)\]\((docs\/)?(screenshots\/[^)]+)\)/g, (m, alt, _d, rel) => {
  const f = path.join('docs', rel);
  if (!fs.existsSync(f)) return `_[missing screenshot ${rel}]_`;
  return `![${alt}](data:image/png;base64,${fs.readFileSync(f).toString('base64')})`;
});

const renderer = new marked.Renderer();
renderer.code = ({ text, lang }) =>
  lang === 'mermaid' ? `<pre class="mermaid">${text}</pre>` : `<pre><code class="lang-${lang ?? ''}">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
const body = marked.parse(md, { renderer, gfm: true });

const html = `<!doctype html><html><head><meta charset="utf-8"><title>ShopSense Project Report</title>
<style>
  @page { size: A4; margin: 18mm 15mm; }
  body { font: 10.5pt/1.5 "Segoe UI", Arial, sans-serif; color: #1f2330; }
  h1 { font-size: 22pt; border-bottom: 2px solid #4f46e5; padding-bottom: 4px; margin-top: 28px; page-break-before: always; }
  h1:first-of-type { page-break-before: avoid; }
  h2 { font-size: 15pt; margin-top: 22px; color: #3730a3; }
  h3 { font-size: 12pt; margin-top: 16px; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 9pt; page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #d5d8e2; padding: 4px 7px; text-align: left; vertical-align: top; }
  th { background: #eef2ff; }
  code { font-family: Consolas, monospace; font-size: 8.6pt; background: #f3f4f8; padding: 1px 3px; border-radius: 3px; }
  pre { background: #f3f4f8; padding: 9px 11px; border-radius: 6px; overflow: hidden; white-space: pre-wrap; word-break: break-word; page-break-inside: avoid; }
  pre code { background: none; padding: 0; }
  pre.mermaid { background: #fff; text-align: center; page-break-inside: auto; }
  img { max-width: 100%; border: 1px solid #d5d8e2; border-radius: 4px; margin: 6px 0; }
  blockquote { border-left: 3px solid #818cf8; margin-left: 0; padding-left: 12px; color: #4b5266; }
  em { color: #4b5266; }
</style></head><body>${body}
<script src="https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js"></script>
<script>
  mermaid.initialize({ startOnLoad: false, theme: 'neutral', er: { useMaxWidth: true, fontSize: 11 }, maxTextSize: 200000 });
  mermaid.run({ querySelector: 'pre.mermaid' }).then(() => { document.body.dataset.ready = '1'; })
    .catch((e) => { document.body.dataset.ready = 'error: ' + e; });
</script></body></html>`;

fs.writeFileSync('docs/.report.html', html);
const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage();
await page.goto('file:///' + path.resolve('docs/.report.html').replace(/\\/g, '/'), { waitUntil: 'networkidle' });
await page.waitForFunction('document.body.dataset.ready', null, { timeout: 120_000 });
const ready = await page.evaluate(() => document.body.dataset.ready);
if (ready !== '1') console.warn('Mermaid warning:', ready);
if (process.env.DEBUG_DIAGRAMS) {
  const els = await page.locator('pre.mermaid').all();
  for (const [i, el] of els.entries()) await el.screenshot({ path: `docs/.diagram-${i}.png` });
  console.log(`debug: ${els.length} diagram screenshot(s) in docs/.diagram-*.png`);
}
await page.pdf({
  path: 'docs/Project-Report.pdf', format: 'A4', printBackground: true,
  margin: { top: '18mm', bottom: '18mm', left: '15mm', right: '15mm' },
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#777">ShopSense — DBMS Level 3 Project &nbsp;·&nbsp; <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
});
await browser.close();
fs.rmSync('docs/.report.html');
console.log(`Wrote docs/Project-Report.pdf (${(fs.statSync('docs/Project-Report.pdf').size / 1024).toFixed(0)} KB)`);
