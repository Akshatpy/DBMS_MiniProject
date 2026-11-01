// Captures the application screenshots used in the report (docs/screenshots/*.png).
// Requires the app to be running (`npm run build && npm start`) and Microsoft Edge installed.
//   BASE_URL=http://localhost:3000 npm run screenshots
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const EDGE = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = 'docs/screenshots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const CREDS = {
  customer: { email: 'customer@shopsense.dev', password: 'Customer@123' },
  seller: { email: 'seller@shopsense.dev', password: 'Seller@123' },
  admin: { email: 'admin@shopsense.dev', password: 'Admin@123' },
};

async function session(role) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  if (role) {
    const res = await ctx.request.post(`${BASE}/api/auth/login`, { data: CREDS[role] });
    if (!res.ok()) throw new Error(`login as ${role} failed: ${res.status()}`);
  }
  return ctx;
}

async function shot(ctx, file, path, { full = true, wait = 400, act } = {}) {
  const page = await ctx.newPage();
  await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 120_000 });
  if (act) await act(page);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: full });
  console.log('captured', file);
  await page.close();
}

// ---- anonymous
let ctx = await session(null);
await shot(ctx, '01-home', '/');
await shot(ctx, '02-search-hybrid', '/search?q=' + encodeURIComponent('gift for a dad who loves gardening') + '&mode=hybrid');
await shot(ctx, '03-search-compare', '/search?q=' + encodeURIComponent("something to keep my dog's teeth clean") + '&compare=1');
await shot(ctx, '04-search-filters', '/search?q=' + encodeURIComponent('comfortable shoes for standing all day') + '&mode=hybrid&maxPrice=3000&minRating=4&inStock=1');
await shot(ctx, '05-login', '/login', { full: false });
await shot(ctx, '06-register', '/register', { full: false });

// a product that has frequently-bought-together rows
const pid = await (async () => {
  const pg = await ctx.newPage();
  const r = await pg.request.get(`${BASE}/api/search?q=${encodeURIComponent('wireless mouse')}&mode=hybrid&limit=1`);
  const id = (await r.json()).hits[0].product_id;
  await pg.close();
  return id;
})();
await shot(ctx, '07-product', `/product/${pid}`);
await ctx.close();

// ---- customer
ctx = await session('customer');
const api = ctx.request;
const hits = (await (await api.get(`${BASE}/api/search?q=${encodeURIComponent('stainless steel water bottle')}&mode=hybrid&inStock=1&limit=3`)).json()).hits;
for (const h of hits.slice(0, 2)) await api.post(`${BASE}/api/cart`, { data: { productId: h.product_id, quantity: 1 } });
await shot(ctx, '08-home-personalised', '/');
await shot(ctx, '09-cart', '/cart');
await shot(ctx, '10-orders', '/orders');
await ctx.close();

// ---- seller
ctx = await session('seller');
await shot(ctx, '11-seller-dashboard', '/seller', { wait: 800 });
await shot(ctx, '12-seller-products', '/seller/products');
await ctx.close();

// ---- admin
ctx = await session('admin');
await shot(ctx, '13-admin-analytics', '/admin', { wait: 800 });
await shot(ctx, '14-admin-search-quality', '/admin/search-quality');
await shot(ctx, '15-admin-users', '/admin/users');
await shot(ctx, '16-admin-lab', '/admin/lab', {
  wait: 500,
  act: async (page) => {
    await page.getByRole('button', { name: /UNSAFE/ }).click();
    await page.getByText('Units sold').first().waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: /SAFE checkout/ }).click();
    await page.getByText('Units sold').nth(1).waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Explain' }).click();
    await page.locator('pre').waitFor({ timeout: 30_000 });
  },
});
await ctx.close();
await browser.close();
console.log(`Screenshots saved in ${OUT}/`);
