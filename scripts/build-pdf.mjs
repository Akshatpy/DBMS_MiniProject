// Markdown -> PDF (blue and white theme) via marked + Edge's PDF printer.
//   node scripts/build-pdf.mjs docs/PROJECT_REPORT.md docs/ShopSense-Project-Report.pdf
// Directives available inside the markdown:
//   {{COVER}}                      cover page + team table from docs/team.json
//   {{TEAM_TABLE}}                 table of students (SRN, name)
//   {{TREE:dir|depth}}             directory tree of the project
//   {{CODE:path|startRegex|n}}     n lines of a source file, starting at the first line matching startRegex
//   {{ER_DIAGRAM}}                 mermaid ER block from docs/ER-diagram.md
// Images whose alt text starts with "crop:" are shown cropped to their top portion.
// Mermaid code fences are rendered in the browser (needs internet for the CDN).
import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';
import { chromium } from 'playwright-core';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('usage: build-pdf.mjs <input.md> <output.pdf>');
const EDGE = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const team = JSON.parse(fs.readFileSync('docs/team.json', 'utf8'));
const read = (f) => fs.readFileSync(f, 'utf8');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------- directives
function tree(dir, depth, prefix = '') {
  const SKIP = new Set(['node_modules', '.next', '.cache', '.git', 'data', 'package-lock.json', 'next-env.d.ts', 'tsconfig.tsbuildinfo']);
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => !SKIP.has(e.name) && !(e.name.startsWith('.env') && e.name !== '.env.example') && e.name !== '.gitignore')
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  const lines = [];
  entries.forEach((e, i) => {
    const last = i === entries.length - 1;
    const full = path.join(dir, e.name);
    if (e.isDirectory() && e.name === 'screenshots') {
      lines.push(`${prefix}${last ? '└── ' : '├── '}screenshots/   (${fs.readdirSync(full).length} images)`);
    } else {
      lines.push(`${prefix}${last ? '└── ' : '├── '}${e.name}${e.isDirectory() ? '/' : ''}`);
      if (e.isDirectory() && depth > 1) lines.push(...tree(full, depth - 1, prefix + (last ? '    ' : '│   ')));
    }
  });
  return lines;
}

function codeBlock(file, startRe, n) {
  const lines = read(file).split(/\r?\n/);
  const i = lines.findIndex((l) => new RegExp(startRe).test(l));
  if (i < 0) throw new Error(`CODE directive: "${startRe}" not found in ${file}`);
  const lang = { '.sql': 'sql', '.ts': 'typescript', '.tsx': 'tsx', '.mjs': 'javascript', '.json': 'json' }[path.extname(file)] ?? '';
  return `<div class="codecap">${file} <span>(line ${i + 1})</span></div>\n\n\`\`\`${lang}\n${lines.slice(i, i + Number(n)).join('\n')}\n\`\`\`\n`;
}

const teamTable = () =>
  '| # | SRN | Name |\n|---|---|---|\n' + team.members.map((m, i) => `| ${i + 1} | ${m.srn} | ${m.name} |`).join('\n') + '\n';

const cover = () => `<section class="cover">
<div class="uni">${team.university}</div>
<div class="dept">${team.department}</div>
<div class="rule"></div>
<div class="kicker">${team.course}</div>
<h1 class="coverTitle">ShopSense</h1>
<div class="subtitle">A Hybrid Semantic Product Discovery Engine with Association-Rule Recommendations</div>
<div class="stack">PostgreSQL 17 &nbsp;+&nbsp; pgvector &nbsp;+&nbsp; Next.js</div>
<table class="coverTeam"><thead><tr><th>SRN</th><th>Name</th></tr></thead><tbody>
${team.members.map((m) => `<tr><td>${m.srn}</td><td>${m.name}</td></tr>`).join('\n')}
</tbody></table>
<div class="meta">${team.instructor ? `Course instructor: ${team.instructor}<br>` : ''}${[team.semester, team.section && `Section ${team.section}`].filter(Boolean).join(' · ')}</div>
<div class="repo">${team.repo}</div>
</section>`;

let md = read(input)
  .replace('{{COVER}}', cover())
  .replace('{{TEAM_TABLE}}', teamTable())
  .replace('{{ER_DIAGRAM}}', () => read('docs/ER-diagram.md').match(/```mermaid[\s\S]*?```/)[0])
  .replace(/\{\{TREE:([^|}]+)\|(\d+)\}\}/g, (_, d, depth) => '```text\n' + d + '/\n' + tree(d, Number(depth)).join('\n') + '\n```\n')
  .replace(/\{\{CODE:([^|}]+)\|([^|}]+)\|(\d+)\}\}/g, (_, f, re, n) => codeBlock(f, re, n));

// images -> data URIs (self-contained PDF); "crop:" alt prefix => cropped frame
md = md.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, src) => {
  const file = path.resolve(path.dirname(input), src);
  if (!fs.existsSync(file)) return `_[missing image ${src}]_`;
  const uri = `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
  const crop = alt.startsWith('crop:');
  const label = crop ? alt.slice(5) : alt;
  return `<figure class="${crop ? 'crop' : ''}"><div class="frame"><img src="${uri}" alt="${label}"></div><figcaption>${label}</figcaption></figure>`;
});

const renderer = new marked.Renderer();
renderer.code = ({ text, lang }) =>
  lang === 'mermaid'
    ? `<pre class="mermaid">${text}</pre>`
    : `<pre><code class="hljs language-${lang ?? ''}">${esc(text)}</code></pre>`;
const body = marked.parse(md, { renderer, gfm: true });

const css = `
@page { size: A4; margin: 16mm 17mm 18mm; }
@page :first { margin: 0; }
* { box-sizing: border-box; }
body { font-family: Cambria, Georgia, 'Times New Roman', serif; font-size: 11pt; line-height: 1.55; color: #1b2438; margin: 0; }
h1, h2, h3, h4, th, .kicker, .uni, .dept, figcaption, .codecap { font-family: Calibri, 'Segoe UI', Arial, sans-serif; }
h1 { color: #1e3a8a; font-size: 22pt; border-bottom: 3px solid #2563eb; padding-bottom: 5px; margin: 0 0 14px; page-break-before: always; }
h2 { color: #1d4ed8; font-size: 15pt; margin: 22px 0 8px; page-break-after: avoid; }
h3 { color: #1e40af; font-size: 12.5pt; margin: 16px 0 6px; page-break-after: avoid; }
p { margin: 6px 0 9px; text-align: justify; }
a { color: #1d4ed8; }
table { border-collapse: collapse; width: 100%; margin: 10px 0 14px; font-size: 9.6pt; }
th { background: #1e3a8a; color: #fff; text-align: left; padding: 6px 9px; font-weight: 600; }
td { padding: 5px 9px; border-bottom: 1px solid #cfdcf7; vertical-align: top; }
tr:nth-child(even) td { background: #f2f6ff; }
tr { page-break-inside: avoid; }
code { font-family: Consolas, 'Cascadia Mono', monospace; font-size: 8.8pt; background: #eaf1ff; color: #17306b; padding: 1px 4px; border-radius: 3px; }
pre { background: #f5f8ff; border: 1px solid #c9d8f6; border-left: 4px solid #2563eb; border-radius: 4px; padding: 9px 12px; margin: 4px 0 14px; white-space: pre-wrap; word-break: break-word; page-break-inside: auto; }
pre code { background: none; padding: 0; font-size: 8.3pt; line-height: 1.4; color: #14233f; }
.codecap { page-break-after: avoid; break-after: avoid; font-size: 9pt; font-weight: 600; color: #fff; background: #2563eb; display: inline-block; padding: 2px 10px; border-radius: 4px 4px 0 0; margin-top: 8px; }
.codecap span { font-weight: 400; opacity: .85; }
blockquote { border-left: 4px solid #60a5fa; background: #eff6ff; margin: 10px 0; padding: 6px 14px; color: #23365f; }
figure { margin: 10px 0 16px; text-align: center; page-break-inside: avoid; }
figure img { max-width: 100%; max-height: 235mm; border: 1px solid #bcd0f5; border-radius: 4px; }
figure .frame { display: block; }
figure.crop .frame { max-height: 150mm; overflow: hidden; border: 1px solid #bcd0f5; border-radius: 4px; }
figure.crop img { width: 100%; max-height: none; display: block; border: 0; border-radius: 0; }
figcaption { font-size: 9pt; color: #3b568f; margin-top: 4px; font-style: italic; }
pre.mermaid { background: #fff; border: 1px solid #c9d8f6; text-align: center; }
.cover { height: 297mm; width: 210mm; padding: 34mm 22mm 20mm; background: linear-gradient(180deg, #1e3a8a 0, #1e3a8a 150mm, #fff 150mm); color: #fff; position: relative; page-break-after: always; }
.cover .uni { font-size: 22pt; font-weight: 700; letter-spacing: .5px; }
.cover .dept { font-size: 13pt; margin-top: 4px; color: #bfdbfe; }
.cover .rule { height: 3px; background: #60a5fa; width: 60mm; margin: 14mm 0 8mm; }
.cover .kicker { font-size: 12pt; color: #dbeafe; max-width: 150mm; }
.cover h1.coverTitle { all: unset; display: block; font-family: Calibri, 'Segoe UI', sans-serif; font-size: 44pt; font-weight: 700; margin-top: 8mm; }
.cover .subtitle { font-size: 16pt; line-height: 1.3; max-width: 150mm; margin-top: 4px; color: #e0ecff; }
.cover .stack { margin-top: 7mm; font-size: 11.5pt; color: #bfdbfe; }
.cover table.coverTeam { position: absolute; top: 168mm; left: 22mm; width: 166mm; color: #1b2438; font-size: 12pt; }
.cover table.coverTeam th { background: #1e3a8a; }
.cover table.coverTeam td { background: #f2f6ff; border-bottom: 1px solid #cfdcf7; padding: 8px 12px; }
.cover .meta { position: absolute; top: 216mm; left: 22mm; color: #23365f; font-size: 11pt; line-height: 1.7; }
.cover .repo { position: absolute; bottom: 18mm; left: 22mm; color: #1d4ed8; font-size: 10.5pt; }
.toc li { margin: 2px 0; }
h1.nb { page-break-before: avoid; margin-top: 26px; }
`;

const html = `<!doctype html><html><head><meta charset="utf-8"><title>ShopSense</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css">
<style>${css}</style></head><body>${body}
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js"></script>
<script>
  document.querySelectorAll('pre code').forEach((el) => hljs.highlightElement(el));
  mermaid.initialize({ startOnLoad: false, theme: 'base', themeVariables: { primaryColor: '#e0ecff', primaryBorderColor: '#2563eb', lineColor: '#2563eb', fontFamily: 'Calibri, sans-serif' }, maxTextSize: 200000 });
  mermaid.run({ querySelector: 'pre.mermaid' }).then(() => { document.body.dataset.ready = '1'; }).catch((e) => { document.body.dataset.ready = 'error: ' + e; });
</script></body></html>`;

const tmp = path.join(path.dirname(output), '.build.html');
fs.writeFileSync(tmp, html);

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage();
await page.goto('file:///' + path.resolve(tmp).replace(/\\/g, '/'), { waitUntil: 'networkidle' });
await page.waitForFunction('document.body.dataset.ready', null, { timeout: 120_000 });
const ready = await page.evaluate(() => document.body.dataset.ready);
if (ready !== '1') console.warn('Mermaid warning:', ready);
await page.pdf({
  path: output, format: 'A4', printBackground: true, preferCSSPageSize: true,
  displayHeaderFooter: true, headerTemplate: '<div></div>',
  footerTemplate: '<div style="font:9px Calibri,sans-serif;width:100%;text-align:center;color:#3b568f">ShopSense · DBMS Level 3 Project · <span class="pageNumber"></span></div>',
});
await browser.close();
fs.rmSync(tmp);
console.log(`Wrote ${output} (${(fs.statSync(output).size / 1024).toFixed(0)} KB)`);
