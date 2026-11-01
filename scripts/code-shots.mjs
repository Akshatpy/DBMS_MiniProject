// Renders real excerpts of the project's source as editor-style screenshots (docs/screenshots/code-*.png)
// for the project report. Needs Microsoft Edge and internet access (highlight.js from a CDN).
//   npm run code-shots
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const EDGE = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = 'docs/screenshots';

// [output name, file, regex of the first line, number of lines]
const SHOTS = [
  ['code-01-schema-products', 'db/02_schema.sql', /^CREATE TABLE products/, 38],
  ['code-02-hnsw-gin-indexes', 'db/03_indexes.sql', /^-- Full-text search: GIN/, 14],
  ['code-03-checkout-function', 'db/04_functions.sql', /^CREATE FUNCTION checkout/, 58],
  ['code-04-hybrid-search', 'db/04_functions.sql', /^  and_match AS MATERIALIZED/, 52],
  ['code-05-low-stock-trigger', 'db/05_triggers.sql', /^CREATE FUNCTION trg_fn_stock_alert/, 30],
  ['code-06-row-level-security', 'db/07_security.sql', /^-- orders: customer sees own/, 22],
  ['code-07-rls-aware-transaction', 'src/lib/db.ts', /^export async function withUser/, 18],
  ['code-08-checkout-api-route', 'src/app/api/checkout/route.ts', /^import/, 21],
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 2 });
fs.mkdirSync(OUT, { recursive: true });

for (const [name, file, startRe, n] of SHOTS) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const start = lines.findIndex((l) => startRe.test(l));
  if (start < 0) throw new Error(`${file}: start line not found for ${name}`);
  const slice = lines.slice(start, start + n);
  const lang = file.endsWith('.sql') ? 'sql' : file.endsWith('.ts') ? 'typescript' : 'javascript';
  const html = `<!doctype html><html><head><meta charset="utf-8">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css">
  <style>
    body { margin: 0; padding: 24px; background: #e8f0fe; font-family: 'Segoe UI', sans-serif; }
    .win { width: 1040px; border-radius: 10px; overflow: hidden; box-shadow: 0 6px 24px rgba(30,58,138,.25); background: #282c34; }
    .bar { background: #1e3a8a; color: #dbeafe; padding: 9px 14px; font-size: 13px; display: flex; align-items: center; gap: 8px; }
    .dot { width: 11px; height: 11px; border-radius: 50%; background: #93c5fd; display: inline-block; }
    .bar span.f { margin-left: 10px; }
    .code { display: flex; padding: 12px 0; font: 13px/1.5 Consolas, 'Cascadia Mono', monospace; }
    .nums { color: #636d83; text-align: right; padding: 0 14px 0 14px; user-select: none; white-space: pre; }
    pre { margin: 0; flex: 1; overflow: hidden; } pre code { background: none !important; padding: 0 !important; font: inherit; }
  </style></head><body>
  <div class="win" id="w"><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span>
    <span class="f">${file} &nbsp;·&nbsp; lines ${start + 1}–${start + slice.length}</span></div>
    <div class="code"><div class="nums">${slice.map((_, i) => start + 1 + i).join('\n')}</div>
    <pre><code class="language-${lang}">${esc(slice.join('\n'))}</code></pre></div></div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
  <script>hljs.highlightAll(); document.body.dataset.ready = '1';</script></body></html>`;
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.waitForFunction('document.body.dataset.ready');
  await page.locator('#w').screenshot({ path: `${OUT}/${name}.png` });
  await page.close();
  console.log('captured', name, `(${file}:${start + 1})`);
}
await browser.close();
