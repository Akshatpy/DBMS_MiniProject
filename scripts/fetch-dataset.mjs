// Streams a curated subset of the public Amazon Reviews 2023 dataset (McAuley Lab, UCSD)
// and writes data/products.jsonl + data/reviews.jsonl. Raw files are never stored on disk:
// we read only the head of each category's review file, pick products that have >= MIN_REVIEWS
// real reviews, then stream that category's metadata until enough of those products are found.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Readable } from 'node:stream';

const BASE = 'https://huggingface.co/datasets/McAuley-Lab/Amazon-Reviews-2023/resolve/main/raw';
const CATEGORIES = [
  'Electronics',
  'Home_and_Kitchen',
  'Sports_and_Outdoors',
  'Clothing_Shoes_and_Jewelry',
  'Beauty_and_Personal_Care',
  'Toys_and_Games',
  'Pet_Supplies',
  'Patio_Lawn_and_Garden',
];
const PRODUCTS_PER_CATEGORY = 375;
const REVIEW_LINES = 250_000;     // head of each review file to scan
const META_LINE_CAP = 400_000;    // safety cap while scanning metadata
const MIN_REVIEWS = 3;
const MAX_REVIEWS_PER_PRODUCT = 6;

const outDir = path.resolve('data');
fs.mkdirSync(outDir, { recursive: true });

function clean(s) {
  return String(s ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function* lines(url, maxLines) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  const rl = readline.createInterface({ input: Readable.fromWeb(res.body), crlfDelay: Infinity });
  let n = 0;
  try {
    for await (const line of rl) {
      if (!line) continue;
      yield line;
      if (++n >= maxLines) break;
    }
  } finally {
    rl.close();
    res.body.cancel?.().catch(() => {});
  }
}

async function processCategory(cat) {
  // 1. Collect candidate products from the head of the review file
  const reviewsByAsin = new Map();
  for await (const line of lines(`${BASE}/review_categories/${cat}.jsonl`, REVIEW_LINES)) {
    const r = JSON.parse(line);
    const text = clean(r.text);
    if (text.length < 40 || text.length > 1500) continue;
    const list = reviewsByAsin.get(r.parent_asin) ?? [];
    if (list.length < MAX_REVIEWS_PER_PRODUCT) {
      list.push({
        parent_asin: r.parent_asin,
        reviewer: r.user_id,
        rating: Math.round(r.rating),
        title: clean(r.title).slice(0, 200),
        body: text,
        helpful_votes: r.helpful_vote ?? 0,
        timestamp: r.timestamp,
      });
      reviewsByAsin.set(r.parent_asin, list);
    }
  }
  const candidates = new Set([...reviewsByAsin].filter(([, l]) => l.length >= MIN_REVIEWS).map(([a]) => a));
  console.log(`[${cat}] ${candidates.size} candidate products with >= ${MIN_REVIEWS} reviews`);

  // 2. Stream metadata and keep good-quality candidate products
  const products = [];
  for await (const line of lines(`${BASE}/meta_categories/meta_${cat}.jsonl`, META_LINE_CAP)) {
    const m = JSON.parse(line);
    if (!candidates.has(m.parent_asin)) continue;
    const title = clean(m.title);
    const description = clean((m.description ?? []).join(' ')).slice(0, 2000);
    const features = (m.features ?? []).map(clean).filter(Boolean).slice(0, 8);
    const image = m.images?.find((i) => i.variant === 'MAIN')?.large ?? m.images?.[0]?.large;
    if (title.length < 10 || title.length > 220 || !image) continue;
    if (description.length + features.join(' ').length < 80) continue;
    products.push({
      asin: m.parent_asin,
      main_category: cat.replaceAll('_', ' '),
      subcategory: clean(m.categories?.[1] ?? '') || null,
      title,
      brand: clean(m.store ?? m.details?.Brand ?? '').slice(0, 120) || null,
      description,
      features,
      price_usd: typeof m.price === 'number' ? m.price : null,
      image_url: image,
      average_rating: m.average_rating,
      rating_number: m.rating_number,
    });
    if (products.length >= PRODUCTS_PER_CATEGORY) break;
  }
  const reviews = products.flatMap((p) => reviewsByAsin.get(p.asin));
  console.log(`[${cat}] kept ${products.length} products, ${reviews.length} reviews`);
  return { products, reviews };
}

// Optional: `node scripts/fetch-dataset.mjs Patio_Lawn_and_Garden --append` re-fetches one category
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = { flags: process.argv.includes('--append') ? 'a' : 'w' };
const selected = only.length ? CATEGORIES.filter((c) => only.includes(c)) : CATEGORIES;
const pOut = fs.createWriteStream(path.join(outDir, 'products.jsonl'), flags);
const rOut = fs.createWriteStream(path.join(outDir, 'reviews.jsonl'), flags);
// Two categories at a time keeps bandwidth reasonable
for (let i = 0; i < selected.length; i += 2) {
  const results = await Promise.all(selected.slice(i, i + 2).map(processCategory));
  for (const { products, reviews } of results) {
    products.forEach((p) => pOut.write(JSON.stringify(p) + '\n'));
    reviews.forEach((r) => rOut.write(JSON.stringify(r) + '\n'));
  }
}
pOut.end();
rOut.end();
console.log('Done. Wrote data/products.jsonl and data/reviews.jsonl');
