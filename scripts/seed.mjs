// Seeds the database with real products/reviews (data/*.jsonl) plus synthetic users, sellers,
// carts and ~18 months of orders. Everything is generated from a fixed random seed, so the
// dataset is reproducible. Run after `npm run db:setup`, then `npm run embed:all`.
import fs from 'node:fs';
import pg from 'pg';

const START = new Date('2025-05-01T00:00:00+05:30');
const NOW = new Date();
const N_CUSTOMERS = 800;
const DAY = 86_400_000;

// ---------------------------------------------------------------- deterministic RNG
let _s = 20251027;
function rand() {
  _s |= 0; _s = (_s + 0x6d2b79f5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randint = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
function weightedPick(items, weights, total) {
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}
const slugify = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------------------------------------------------------------- reference data
const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan', 'Krishna', 'Ishaan',
  'Rohan', 'Kabir', 'Dhruv', 'Aryan', 'Karthik', 'Nikhil', 'Rahul', 'Siddharth', 'Varun', 'Pranav',
  'Ananya', 'Diya', 'Aadhya', 'Saanvi', 'Ira', 'Myra', 'Aarohi', 'Anika', 'Navya', 'Kavya',
  'Priya', 'Sneha', 'Meera', 'Riya', 'Tanvi', 'Shreya', 'Pooja', 'Nisha', 'Lakshmi', 'Divya',
  'Harsh', 'Manav', 'Yash', 'Akash', 'Tejas', 'Neha', 'Ishita', 'Sanya', 'Zara', 'Farhan'];
const LAST = ['Sharma', 'Verma', 'Iyer', 'Reddy', 'Nair', 'Patel', 'Gupta', 'Rao', 'Menon', 'Kulkarni',
  'Joshi', 'Desai', 'Bose', 'Chatterjee', 'Mehta', 'Kapoor', 'Singh', 'Pillai', 'Shetty', 'Bhat',
  'Agarwal', 'Mishra', 'Das', 'Hegde', 'Naidu', 'Khan', 'Fernandes', 'Saxena', 'Malhotra', 'Gowda'];
const CITIES = [
  ['Bengaluru', 'Karnataka', '560'], ['Mumbai', 'Maharashtra', '400'], ['Delhi', 'Delhi', '110'],
  ['Chennai', 'Tamil Nadu', '600'], ['Hyderabad', 'Telangana', '500'], ['Pune', 'Maharashtra', '411'],
  ['Kolkata', 'West Bengal', '700'], ['Ahmedabad', 'Gujarat', '380'], ['Jaipur', 'Rajasthan', '302'],
  ['Kochi', 'Kerala', '682'], ['Mysuru', 'Karnataka', '570'], ['Lucknow', 'Uttar Pradesh', '226'],
];
const STREETS = ['MG Road', 'Residency Road', 'Church Street', '4th Cross', 'Ring Road', 'Station Road',
  'Lake View Layout', 'Park Street', 'Temple Road', 'Main Road', '100 Feet Road', 'Nehru Nagar'];
const STORES = {
  'Electronics': ['VoltKart Electronics', 'CircuitBay', 'Pixel Bazaar'],
  'Home and Kitchen': ['Ghar Essentials', 'KitchenKraft', 'HomeNest Living'],
  'Sports and Outdoors': ['TrailBlaze Sports', 'FitFuel Gear', 'Summit Outdoors'],
  'Clothing Shoes and Jewelry': ['Threadline Fashion', 'Kurta & Co', 'SoleStreet'],
  'Beauty and Personal Care': ['GlowVeda', 'Bloom Beauty', 'PureSkin Labs'],
  'Toys and Games': ['PlayPark Toys', 'Brainy Bricks', 'FunFactory'],
  'Pet Supplies': ['Pawsome Supplies', 'TailWag Store', 'Whiskers & Paws'],
  'Patio Lawn and Garden': ['GreenThumb Garden', 'Bagicha Supplies', 'Petal & Spade'],
};
const MEDIAN_PRICE = {
  'Electronics': 1800, 'Home and Kitchen': 1200, 'Sports and Outdoors': 1100, 'Clothing Shoes and Jewelry': 900,
  'Beauty and Personal Care': 450, 'Toys and Games': 800, 'Pet Supplies': 600, 'Patio Lawn and Garden': 1000,
};
// Month-of-year demand multipliers (festive Oct/Nov, wedding season, summer dip)
const SEASON = [0.85, 0.9, 1.0, 0.95, 0.9, 0.85, 0.95, 1.05, 1.1, 1.55, 1.6, 1.3];
// Category-specific seasonality boosts by month index
const CAT_SEASON = {
  'Patio Lawn and Garden': { 1: 1.4, 2: 1.6, 3: 1.5, 6: 1.3, 7: 1.3 },
  'Toys and Games': { 9: 1.4, 10: 1.6, 11: 1.8 },
  'Clothing Shoes and Jewelry': { 9: 1.5, 10: 1.6, 3: 1.2 },
  'Electronics': { 9: 1.4, 10: 1.5 },
  'Sports and Outdoors': { 0: 1.4, 4: 1.2, 5: 1.2 },
};

const niceInr = (x) => Math.max(49, Math.round(x / 10) * 10 - 1);
function gstin(i) {
  const L = 'ABCDEFGHIJKLMNPQRSTUVWXYZ';
  const p = Array.from({ length: 5 }, () => L[randint(0, L.length - 1)]).join('');
  return `29${p}${String(1000 + i).padStart(4, '0')}${L[randint(0, 24)]}${randint(1, 9)}Z${randint(0, 9)}`;
}
function phone() { return `${randint(6, 9)}${String(randint(0, 999_999_999)).padStart(9, '0')}`; }

// ---------------------------------------------------------------- load dataset
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const rawProducts = readJsonl('data/products.jsonl');
const rawReviews = readJsonl('data/reviews.jsonl');
console.log(`Loaded ${rawProducts.length} products, ${rawReviews.length} reviews from data/`);

const db = new pg.Client({ connectionString: process.env.OWNER_DATABASE_URL });
await db.connect();
const q = (text, params) => db.query(text, params);

async function main() {
  const { rows: [{ cnt }] } = await q('SELECT count(*)::int AS cnt FROM products');
  if (cnt > 0) throw new Error('Database already seeded. Run `npm run db:setup -- --reset` first.');

  await q('BEGIN');
  const { rows: [{ h: commonHash }] } = await q(`SELECT crypt('Password@123', gen_salt('bf', 8)) AS h`);
  const hash = async (pw) => (await q(`SELECT crypt($1, gen_salt('bf', 10)) AS h`, [pw])).rows[0].h;

  // ---------------- categories (2 levels)
  const topNames = [...new Set(rawProducts.map((p) => p.main_category))];
  const catId = new Map(); // "top" or "top|sub" -> id
  for (const top of topNames) {
    const { rows } = await q('INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING category_id', [top, slugify(top)]);
    catId.set(top, rows[0].category_id);
  }
  for (const p of rawProducts) {
    p.sub = p.subcategory && p.subcategory !== p.main_category ? p.subcategory : 'General';
    const key = `${p.main_category}|${p.sub}`;
    if (!catId.has(key)) {
      const { rows } = await q('INSERT INTO categories (name, slug, parent_id) VALUES ($1, $2, $3) RETURNING category_id',
        [p.sub, `${slugify(p.main_category)}-${slugify(p.sub)}`, catId.get(p.main_category)]);
      catId.set(key, rows[0].category_id);
    }
  }
  console.log(`categories: ${catId.size}`);

  // ---------------- users: admin, sellers, customers
  async function insertUsers(list) {
    const { rows } = await q(
      `INSERT INTO users (email, password_hash, full_name, phone, role, created_at)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::user_role[], $6::timestamptz[])
       RETURNING user_id, email`,
      [list.map((u) => u.email), list.map((u) => u.hash), list.map((u) => u.name), list.map((u) => u.phone),
       list.map((u) => u.role), list.map((u) => u.created_at)]);
    const byEmail = new Map(rows.map((r) => [r.email, r.user_id]));
    list.forEach((u) => { u.id = byEmail.get(u.email); });
    return list;
  }
  const t0 = START.toISOString();
  await insertUsers([{ email: 'admin@shopsense.dev', hash: await hash('Admin@123'), name: 'Platform Admin', phone: phone(), role: 'admin', created_at: t0 }]);

  // sellers
  const sellerUsers = [];
  let si = 0;
  for (const top of topNames) {
    for (const store of STORES[top] ?? [`${top} Store`]) {
      const email = si === 0 ? 'seller@shopsense.dev' : `${slugify(store).replace(/-/g, '.')}@sellers.shopsense.dev`;
      sellerUsers.push({ email, hash: si === 0 ? await hash('Seller@123') : commonHash,
        name: `${pick(FIRST)} ${pick(LAST)}`, phone: phone(), role: 'seller', created_at: t0, store, top });
      si++;
    }
  }
  sellerUsers.push({ email: 'lab.seller@shopsense.dev', hash: commonHash, name: 'Lab Seller', phone: phone(),
    role: 'seller', created_at: t0, store: 'ShopSense Lab', top: null });
  await insertUsers(sellerUsers);
  for (const [i, s] of sellerUsers.entries()) {
    await q(`INSERT INTO sellers (seller_id, store_name, gstin, support_email, is_verified, joined_at)
             VALUES ($1, $2, $3, $4, TRUE, $5)`, [s.id, s.store, gstin(i), s.email, t0]);
  }
  const sellersByTop = Object.groupBy(sellerUsers.filter((s) => s.top), (s) => s.top);

  // customers
  const customers = [
    { email: 'customer@shopsense.dev', hash: await hash('Customer@123'), name: 'Aarav Sharma', demo: true },
    { email: 'lab.buyer1@shopsense.dev', hash: commonHash, name: 'Lab Buyer One', lab: true },
    { email: 'lab.buyer2@shopsense.dev', hash: commonHash, name: 'Lab Buyer Two', lab: true },
  ];
  const usedEmails = new Set(customers.map((c) => c.email));
  while (customers.length < N_CUSTOMERS) {
    const f = pick(FIRST), l = pick(LAST);
    let email = `${f}.${l}${randint(1, 999)}@example.com`.toLowerCase();
    if (usedEmails.has(email)) continue;
    usedEmails.add(email);
    customers.push({ email, hash: commonHash, name: `${f} ${l}` });
  }
  for (const c of customers) {
    c.role = 'customer';
    c.phone = phone();
    c.created_at = new Date(START.getTime() - randint(0, 200) * DAY).toISOString();
    // each customer has 1-2 favourite top-level categories => personalisation has signal
    c.prefs = [pick(topNames)];
    if (rand() < 0.5) c.prefs.push(pick(topNames));
    c.activity = Math.pow(rand(), 2.2); // heavy-tailed: few very active customers
  }
  const demo = customers[0];
  demo.prefs = ['Electronics', 'Sports and Outdoors'];
  demo.activity = 0.35;
  customers[1].activity = customers[2].activity = 0;
  await insertUsers(customers);

  await q(`INSERT INTO customer_profiles (user_id, date_of_birth, preferred_category_id)
           SELECT * FROM unnest($1::bigint[], $2::date[], $3::int[])`,
    [customers.map((c) => c.id),
     customers.map(() => `${randint(1970, 2005)}-${String(randint(1, 12)).padStart(2, '0')}-${String(randint(1, 28)).padStart(2, '0')}`),
     customers.map((c) => catId.get(c.prefs[0]))]);
  await q('INSERT INTO carts (user_id) SELECT unnest($1::bigint[])', [customers.map((c) => c.id)]);

  // addresses (1-2 each, first is default)
  const addr = { user: [], label: [], line1: [], city: [], state: [], pin: [], def: [] };
  for (const c of customers) {
    const n = rand() < 0.3 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const [city, state, prefix] = pick(CITIES);
      addr.user.push(c.id); addr.label.push(k === 0 ? 'Home' : 'Work');
      addr.line1.push(`${randint(1, 450)}, ${pick(STREETS)}`); addr.city.push(city); addr.state.push(state);
      addr.pin.push(`${prefix}${String(randint(1, 99)).padStart(3, '0')}`); addr.def.push(k === 0);
    }
  }
  const { rows: addrRows } = await q(
    `INSERT INTO addresses (user_id, label, line1, city, state, pincode, is_default)
     SELECT * FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::bool[])
     RETURNING address_id, user_id, is_default`,
    [addr.user, addr.label, addr.line1, addr.city, addr.state, addr.pin, addr.def]);
  const defaultAddr = new Map(addrRows.filter((a) => a.is_default).map((a) => [String(a.user_id), a.address_id]));
  console.log(`users: ${customers.length} customers, ${sellerUsers.length} sellers, 1 admin; addresses: ${addrRows.length}`);

  // ---------------- products
  for (const p of rawProducts) {
    const seller = pick(sellersByTop[p.main_category]);
    p.seller_id = seller.id;
    p.category_id = catId.get(`${p.main_category}|${p.sub}`);
    p.price = p.price_usd
      ? niceInr(p.price_usd * 83)
      : niceInr(MEDIAN_PRICE[p.main_category] * Math.exp((rand() - 0.5) * 1.6));
    p.mrp = Math.max(p.price, niceInr(p.price * (1.05 + rand() * 0.55)));
    p.threshold = pick([5, 10, 10, 15, 20]);
    const r = rand();
    p.stock = r < 0.02 ? 0 : r < 0.10 ? randint(1, p.threshold - 1) : randint(25, 300);
    p.popularity = Math.sqrt((p.rating_number ?? 1) + 1);
  }
  const { rows: prodRows } = await q(
    `INSERT INTO products (seller_id, category_id, asin, title, brand, description, features, price, mrp,
                           stock_qty, reorder_threshold, image_url, created_at)
     SELECT *, $13::timestamptz FROM unnest($1::bigint[], $2::int[], $3::text[], $4::text[], $5::text[], $6::text[],
                         $7::text[], $8::numeric[], $9::numeric[], $10::int[], $11::int[], $12::text[])
     RETURNING product_id, asin`,
    [rawProducts.map((p) => p.seller_id), rawProducts.map((p) => p.category_id), rawProducts.map((p) => p.asin),
     rawProducts.map((p) => p.title), rawProducts.map((p) => p.brand), rawProducts.map((p) => p.description),
     rawProducts.map((p) => p.features.join('\n')), rawProducts.map((p) => p.price), rawProducts.map((p) => p.mrp),
     rawProducts.map((p) => p.stock), rawProducts.map((p) => p.threshold), rawProducts.map((p) => p.image_url), t0]);
  const pidByAsin = new Map(prodRows.map((r) => [r.asin, r.product_id]));
  rawProducts.forEach((p) => { p.id = pidByAsin.get(p.asin); });

  // the concurrency-lab product: exactly one unit, owned by the lab seller
  const labSeller = sellerUsers.find((s) => s.store === 'ShopSense Lab');
  await q(`INSERT INTO products (seller_id, category_id, asin, title, brand, description, features, price, mrp,
                                 stock_qty, reorder_threshold, image_url)
           VALUES ($1, $2, 'LAB-LAST-UNIT', 'Concurrency Lab: Last-Unit Collector''s Edition', 'ShopSense Lab',
                   'A limited item with exactly one unit in stock. Used to demonstrate row locking during checkout.',
                   'Only one unit\nUsed by the admin concurrency lab', 999, 1499, 1, 0, NULL)`,
          [labSeller.id, catId.get(`${topNames[0]}|General`) ?? catId.get(topNames[0])]);
  console.log(`products: ${rawProducts.length + 1}`);

  // ---------------- planted co-purchase structure ("frequently bought together")
  const STOP = new Set(('with for and the pack set inch inches size black white blue green pink grey gray red '
    + 'large small medium piece pieces count compatible women womens men mens kids girls boys adult adults '
    + 'from this that your premium quality style new 100 2 3 4 5 6 8 10 12 one two three free natural '
    + 'pcs ounce oz lbs color colors multicolor gift gifts pair easy best great perfect').split(' '));
  const tokens = (t) => [...new Set(t.toLowerCase().match(/[a-z]{4,}/g) ?? [])].filter((w) => !STOP.has(w));
  const byTop = Object.groupBy(rawProducts, (p) => p.main_category);
  for (const list of Object.values(byTop)) {
    const df = new Map();
    list.forEach((p) => { p.tok = tokens(p.title); p.tok.forEach((w) => df.set(w, (df.get(w) ?? 0) + 1)); });
    for (const p of list) {
      const salient = new Set(p.tok.filter((w) => df.get(w) >= 2 && df.get(w) <= 40));
      const scored = list.filter((o) => o !== p)
        .map((o) => [o, o.tok.filter((w) => salient.has(w)).length])
        .filter(([, s]) => s > 0)
        .sort((a, b) => b[1] - a[1] || a[0].id - b[0].id);
      p.partners = scored.slice(0, 2).map(([o]) => o);
      if (p.partners.length === 0) p.partners = [pick(list.filter((o) => o.sub === p.sub && o !== p)) ?? pick(list)];
    }
  }

  // ---------------- orders
  const popWeights = Object.fromEntries(Object.entries(byTop).map(([k, l]) => [k, {
    items: l, w: l.map((p) => p.popularity), total: l.reduce((s, p) => s + p.popularity, 0) }]));
  const custW = customers.map((c) => c.activity);
  const custTotal = custW.reduce((a, b) => a + b, 0);

  const orders = [];
  const items = [];
  const buyers = new Map(); // product id -> [{user, date}]
  let orderId = 0;
  const totalDays = Math.floor((NOW - START) / DAY);
  for (let d = 0; d <= totalDays; d++) {
    const day = new Date(START.getTime() + d * DAY);
    const month = day.getMonth();
    const growth = 14 + 22 * (d / totalDays);
    const weekend = [0, 6].includes(day.getDay()) ? 1.15 : 1;
    const n = Math.round(growth * SEASON[month] * weekend * (0.8 + rand() * 0.4));
    for (let k = 0; k < n; k++) {
      const c = weightedPick(customers, custW, custTotal);
      // category choice, with category-specific seasonality
      const catChoices = topNames.map((t) => (c.prefs.includes(t) ? 6 : 1) * (CAT_SEASON[t]?.[month] ?? 1));
      const top = weightedPick(topNames, catChoices, catChoices.reduce((a, b) => a + b, 0));
      const pw = popWeights[top];
      const basket = new Map();
      const add = (p) => { if (!basket.has(p.id)) basket.set(p.id, { p, qty: rand() < 0.9 ? 1 : rand() < 0.8 ? 2 : 3 }); };
      const primary = weightedPick(pw.items, pw.w, pw.total);
      add(primary);
      if (rand() < 0.55) add(primary.partners[0]);
      if (primary.partners[1] && rand() < 0.25) add(primary.partners[1]);
      if (rand() < 0.12) add(weightedPick(pw.items, pw.w, pw.total));

      const placed = new Date(day.getTime() + randint(7, 23) * 3_600_000 + randint(0, 3599) * 1000);
      if (placed > NOW) continue;
      const ageDays = (NOW - placed) / DAY;
      const method = weightedPick(['upi', 'card', 'netbanking', 'cod'], [50, 25, 10, 15], 100);
      let status;
      if (rand() < 0.04) status = 'cancelled';
      else if (ageDays > 10) status = 'delivered';
      else if (ageDays > 4) status = rand() < 0.6 ? 'delivered' : 'shipped';
      else status = method === 'cod' ? (rand() < 0.5 ? 'pending' : 'shipped') : (rand() < 0.5 ? 'paid' : 'shipped');
      const subtotal = [...basket.values()].reduce((s, { p, qty }) => s + p.price * qty, 0);
      const fee = subtotal >= 499 ? 0 : 40;
      orderId++;
      orders.push({ id: orderId, user: c.id, addr: defaultAddr.get(String(c.id)), status, subtotal, fee,
        placed: placed.toISOString(), method });
      for (const { p, qty } of basket.values()) {
        items.push([orderId, p.id, qty, p.price]);
        if (status !== 'cancelled') {
          if (!buyers.has(p.id)) buyers.set(p.id, []);
          buyers.get(p.id).push({ user: c.id, date: placed });
        }
      }
    }
  }

  const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
  for (const part of chunk(orders, 3000)) {
    await q(`INSERT INTO orders (order_id, user_id, address_id, status, subtotal, shipping_fee, total_amount, placed_at, updated_at)
             OVERRIDING SYSTEM VALUE
             SELECT o, u, a, s, sub, f, sub + f, t, t
               FROM unnest($1::bigint[], $2::bigint[], $3::bigint[], $4::order_status[], $5::numeric[], $6::numeric[], $7::timestamptz[])
                    AS x(o, u, a, s, sub, f, t)`,
      [part.map((o) => o.id), part.map((o) => o.user), part.map((o) => o.addr), part.map((o) => o.status),
       part.map((o) => o.subtotal), part.map((o) => o.fee), part.map((o) => o.placed)]);
    await q(`INSERT INTO payments (order_id, method, amount, status, transaction_ref, created_at)
             SELECT * FROM unnest($1::bigint[], $2::payment_method[], $3::numeric[], $4::payment_status[], $5::text[], $6::timestamptz[])`,
      [part.map((o) => o.id), part.map((o) => o.method), part.map((o) => o.subtotal + o.fee),
       part.map((o) => o.status === 'cancelled' ? (o.method === 'cod' ? 'failed' : 'refunded')
         : o.method === 'cod' && o.status !== 'delivered' ? 'pending' : 'success'),
       part.map((o) => (o.method === 'cod' ? null : `TXN${String(o.id).padStart(10, '0')}`)), part.map((o) => o.placed)]);
  }
  for (const part of chunk(items, 5000)) {
    await q(`INSERT INTO order_items (order_id, product_id, quantity, unit_price)
             SELECT * FROM unnest($1::bigint[], $2::bigint[], $3::int[], $4::numeric[])`,
      [part.map((i) => i[0]), part.map((i) => i[1]), part.map((i) => i[2]), part.map((i) => i[3])]);
  }
  await q(`SELECT setval(pg_get_serial_sequence('orders', 'order_id'), (SELECT max(order_id) FROM orders))`);
  console.log(`orders: ${orders.length}, order lines: ${items.length}`);

  // ---------------- reviews (real text; author = a real buyer of that product when possible)
  const reviewed = new Set();
  const rv = { pid: [], uid: [], rating: [], title: [], body: [], helpful: [], at: [] };
  for (const r of rawReviews) {
    const pid = pidByAsin.get(r.parent_asin);
    if (!pid) continue;
    const pool = (buyers.get(pid) ?? []).filter((b) => !reviewed.has(`${pid}:${b.user}`));
    let uid, at;
    if (pool.length && rand() < 0.85) {
      const b = pick(pool);
      uid = b.user;
      at = new Date(Math.min(b.date.getTime() + randint(3, 25) * DAY, NOW.getTime() - randint(1, 48) * 3_600_000));
    } else {
      do { uid = pick(customers).id; } while (reviewed.has(`${pid}:${uid}`));
      at = new Date(START.getTime() + rand() * (NOW - START));
    }
    reviewed.add(`${pid}:${uid}`);
    rv.pid.push(pid); rv.uid.push(uid); rv.rating.push(Math.min(5, Math.max(1, r.rating)));
    rv.title.push(r.title || null); rv.body.push(r.body); rv.helpful.push(r.helpful_votes); rv.at.push(at.toISOString());
  }
  await q(`INSERT INTO reviews (product_id, user_id, rating, title, body, helpful_votes, created_at)
           SELECT * FROM unnest($1::bigint[], $2::bigint[], $3::smallint[], $4::text[], $5::text[], $6::int[], $7::timestamptz[])`,
    [rv.pid, rv.uid, rv.rating, rv.title, rv.body, rv.helpful, rv.at]);
  console.log(`reviews: ${rv.pid.length}`);

  // ---------------- carts
  const inStock = rawProducts.filter((p) => p.stock >= 5);
  for (const c of [demo, ...customers.slice(3, 60)]) {
    const n = c === demo ? 2 : randint(1, 3);
    const chosen = new Set();
    while (chosen.size < n) chosen.add(pick(inStock.filter((p) => c.prefs.includes(p.main_category))) ?? pick(inStock));
    for (const p of chosen) {
      await q(`INSERT INTO cart_items (cart_id, product_id, quantity)
               VALUES ((SELECT cart_id FROM carts WHERE user_id = $1), $2, 1)`, [c.id, p.id]);
    }
  }

  await q('COMMIT');
  // materialized views are populated now that orders exist (taste profiles need embeddings: see embed:all)
  await q('CALL refresh_analytics()');
  const { rows: [stats] } = await q(`SELECT (SELECT count(*) FROM embedding_jobs WHERE processed_at IS NULL) AS jobs,
                                            (SELECT count(*) FROM stock_alerts WHERE resolved_at IS NULL) AS alerts,
                                            (SELECT count(*) FROM mv_product_pairs) AS pairs,
                                            (SELECT count(*) FROM reviews WHERE verified_purchase) AS verified`);
  console.log(`queued embedding jobs: ${stats.jobs}, open stock alerts: ${stats.alerts}, ` +
              `product pairs: ${stats.pairs}, verified reviews: ${stats.verified}`);
  console.log('Seed complete. Next: npm run embed:all');
}

try {
  await main();
} catch (e) {
  await q('ROLLBACK').catch(() => {});
  console.error('Seed failed:', e.message, e.detail ?? '', e.where ?? '');
  process.exitCode = 1;
} finally {
  await db.end();
}
