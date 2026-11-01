// Database integration tests. Run with: npm test   (requires a seeded database)
// Fixtures are created through the owner connection and removed afterwards; every assertion
// runs through the least-privilege `shopsense_app` role, exactly as the web app does.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const owner = new pg.Pool({ connectionString: process.env.OWNER_DATABASE_URL, max: 4 });
const app = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 6 });
const tag = Date.now().toString(36);
const fx = {}; // fixtures: users, products, addresses

/** Run fn inside a transaction as the given end user; always ROLLBACK unless commit = true. */
async function as(uid, fn, { commit = false } = {}) {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.user_id', $1, true)`, [uid == null ? '' : String(uid)]);
    const out = await fn(c);
    await c.query(commit ? 'COMMIT' : 'ROLLBACK');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
/** Assert a promise rejects with the given SQLSTATE (or constraint name). */
/** After an expected error the transaction is aborted; wrap each expectation in its own savepoint. */
const rejectsSp = async (c, p, code) => {
  await c.query('SAVEPOINT sp');
  await rejects(p(), code);
  await c.query('ROLLBACK TO sp');
};
const rejects = (p, code) => assert.rejects(p, (e) => (code.length === 5 ? e.code === code : e.constraint === code || e.code === code) || (console.error(e.code, e.constraint, e.message), false));

before(async () => {
  const id = async (sql, params) => (await owner.query(sql, params)).rows[0].id;
  fx.c1 = await id(`SELECT register_customer($1, 'Passw0rdOne', 'Test Buyer One', '9876543210') AS id`, [`t1.${tag}@test.dev`]);
  fx.c2 = await id(`SELECT register_customer($1, 'Passw0rdTwo', 'Test Buyer Two', NULL) AS id`, [`t2.${tag}@test.dev`]);
  fx.s1 = await id(`SELECT register_seller($1, 'Passw0rdSel', 'Test Seller One', $2, '29ABCDE1234F1Z5', NULL) AS id`, [`s1.${tag}@test.dev`, `Test Store A ${tag}`]);
  fx.s2 = await id(`SELECT register_seller($1, 'Passw0rdSel', 'Test Seller Two', $2, NULL, NULL) AS id`, [`s2.${tag}@test.dev`, `Test Store B ${tag}`]);
  fx.cat = await id(`SELECT category_id AS id FROM categories WHERE parent_id IS NOT NULL LIMIT 1`);
  const prod = (seller, title, price, stock, threshold) => id(
    `INSERT INTO products (seller_id, category_id, title, price, mrp, stock_qty, reorder_threshold, description)
     VALUES ($1, $2, $3, $4::numeric, $4::numeric + 50, $5, $6, 'zzyzx fixture product for tests') RETURNING product_id AS id`,
    [seller, fx.cat, `${title} ${tag}`, price, stock, threshold]);
  fx.p1 = await prod(fx.s1, 'Fixture Alpha', 500, 5, 3);
  fx.p2 = await prod(fx.s2, 'Fixture Beta', 300, 1, 0);
  fx.p3 = await prod(fx.s1, 'Fixture Gamma', 100, 50, 3);
  fx.p4 = await prod(fx.s1, 'Fixture Delta (never ordered)', 100, 50, 3);
  for (const u of [fx.c1, fx.c2]) {
    fx[`a${u}`] = await id(`INSERT INTO addresses (user_id, line1, city, state, pincode, is_default)
                             VALUES ($1, '12 Test Street', 'Bengaluru', 'Karnataka', '560001', TRUE) RETURNING address_id AS id`, [u]);
  }
});

after(async () => {
  const users = [fx.c1, fx.c2, fx.s1, fx.s2];
  await owner.query('DELETE FROM orders WHERE user_id = ANY($1)', [users]);
  await owner.query('DELETE FROM reviews WHERE user_id = ANY($1)', [users]);
  await owner.query('DELETE FROM embedding_jobs WHERE entity_type = \'product\' AND entity_id = ANY($1)', [[fx.p1, fx.p2, fx.p3, fx.p4]]);
  await owner.query('DELETE FROM products WHERE seller_id = ANY($1)', [users]);
  await owner.query('DELETE FROM sellers WHERE seller_id = ANY($1)', [users]);
  await owner.query('DELETE FROM users WHERE user_id = ANY($1)', [users]);
  await owner.end();
  await app.end();
});

// ---------------------------------------------------------------- authentication
test('authenticate: correct password succeeds, wrong password and unknown email fail', async () => {
  const ok = await app.query(`SELECT * FROM authenticate($1, 'Passw0rdOne')`, [`T1.${tag}@TEST.dev`]); // case-insensitive email
  assert.equal(ok.rowCount, 1);
  assert.equal(ok.rows[0].role, 'customer');
  assert.equal((await app.query(`SELECT * FROM authenticate($1, 'wrong-password')`, [`t1.${tag}@test.dev`])).rowCount, 0);
  assert.equal((await app.query(`SELECT * FROM authenticate('nobody@test.dev', 'x')`)).rowCount, 0);
});

test('passwords are stored as bcrypt hashes and the app role cannot read them', async () => {
  const { rows } = await owner.query('SELECT password_hash FROM users WHERE user_id = $1', [fx.c1]);
  assert.match(rows[0].password_hash, /^\$2[abxy]\$/);
  await rejects(app.query('SELECT password_hash FROM users LIMIT 1'), '42501'); // column-level GRANT
});

test('register_customer rejects weak passwords (SS005) and duplicate emails', async () => {
  await rejects(owner.query(`SELECT register_customer($1, 'short1', 'Weak Pass')`, [`w.${tag}@test.dev`]), 'SS005');
  await rejects(owner.query(`SELECT register_customer($1, 'allletters', 'Weak Pass')`, [`w.${tag}@test.dev`]), 'SS005');
  await rejects(owner.query(`SELECT register_customer($1, 'Passw0rdOne', 'Dup Email')`, [`t1.${tag}@test.dev`]), 'uq_users_email');
});

// ---------------------------------------------------------------- constraints & domains
test('domains and CHECK constraints reject invalid data at the database level', async () => {
  const bad = (sql, params, code) => rejects(owner.query(sql, params), code);
  await bad(`SELECT register_customer('not-an-email', 'Passw0rd1', 'Bad Email')`, [], '23514');
  await bad(`SELECT register_customer($1, 'Passw0rd1', 'Bad Phone', '12345')`, [`p.${tag}@test.dev`], '23514');
  await bad(`INSERT INTO addresses (user_id, line1, city, state, pincode) VALUES ($1, 'x street', 'c', 's', '012345')`, [fx.c1], '23514');
  await bad(`SELECT register_seller($1, 'Passw0rd1', 'Bad Gst', $2, 'NOT-A-GSTIN')`, [`g.${tag}@test.dev`, `Bad GST ${tag}`], '23514');
  await bad(`UPDATE products SET price = 0 WHERE product_id = $1`, [fx.p1], 'products_price_check');
  await bad(`UPDATE products SET mrp = 1 WHERE product_id = $1`, [fx.p1], 'chk_products_mrp_ge_price');
  await bad(`UPDATE products SET stock_qty = -1 WHERE product_id = $1`, [fx.p1], 'products_stock_qty_check');
  await bad(`INSERT INTO reviews (product_id, user_id, rating, body) VALUES ($1, $2, 6, 'rating out of range here')`, [fx.p1, fx.c1], 'reviews_rating_check');
  await bad(`INSERT INTO reviews (product_id, user_id, rating, body) VALUES ($1, $2, 3, 'short')`, [fx.p1, fx.c1], 'reviews_body_check');
});

test('a seller row can only exist for a user whose role is seller (composite FK)', async () => {
  await rejects(owner.query(`INSERT INTO sellers (seller_id, store_name) VALUES ($1, $2)`, [fx.c1, `Not A Seller ${tag}`]), 'fk_sellers_user_is_seller');
});

// ---------------------------------------------------------------- checkout transaction
test('checkout: creates order, decrements stock, clears cart, snapshots price (atomic)', async () => {
  await as(fx.c1, async (c) => {
    await c.query('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (my_cart_id(), $1, 2)', [fx.p1]);
    await c.query('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (my_cart_id(), $1, 1)', [fx.p3]);
    const { rows: [{ order_id }] } = await c.query(`SELECT checkout($1, 'upi') AS order_id`, [fx[`a${fx.c1}`]]);
    const o = (await c.query('SELECT * FROM orders WHERE order_id = $1', [order_id])).rows[0];
    assert.equal(o.status, 'paid');
    assert.equal(Number(o.subtotal), 1100);
    assert.equal(Number(o.shipping_fee), 0); // >= 499 ships free
    assert.equal(Number(o.total_amount), 1100);
    assert.equal((await c.query('SELECT stock_qty FROM products WHERE product_id = $1', [fx.p1])).rows[0].stock_qty, 3);
    assert.equal((await c.query('SELECT count(*)::int AS n FROM cart_items')).rows[0].n, 0);
    assert.equal((await c.query('SELECT count(*)::int AS n FROM payments WHERE order_id = $1', [order_id])).rows[0].n, 1);
    assert.equal((await c.query('SELECT count(*)::int AS n FROM order_status_history WHERE order_id = $1', [order_id])).rows[0].n, 1);
  });
});

test('checkout: empty cart (SS002) and insufficient stock (SS001) abort with no partial effects', async () => {
  await as(fx.c1, async (c) => {
    await rejects(c.query(`SELECT checkout($1, 'upi')`, [fx[`a${fx.c1}`]]), 'SS002');
  });
  // cart trigger blocks adding more than the stock
  await as(fx.c1, async (c) => {
    await rejects(c.query('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (my_cart_id(), $1, 5)', [fx.p2]), 'SS001');
  });
  // stock shrinks AFTER the item is in the cart: checkout itself must catch it and roll back
  await owner.query('UPDATE products SET stock_qty = 5 WHERE product_id = $1', [fx.p1]);
  await as(fx.c1, async (c) => {
    await c.query('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (my_cart_id(), $1, 4)', [fx.p1]);
    await owner.query('UPDATE products SET stock_qty = 2 WHERE product_id = $1', [fx.p1]);
    await rejects(c.query(`SELECT checkout($1, 'upi')`, [fx[`a${fx.c1}`]]), 'SS001');
  });
  assert.equal((await owner.query('SELECT count(*)::int n FROM orders WHERE user_id = $1', [fx.c1])).rows[0].n, 0, 'no order row was left behind');
  assert.equal((await owner.query('SELECT stock_qty FROM products WHERE product_id = $1', [fx.p1])).rows[0].stock_qty, 2);
  await owner.query('UPDATE products SET stock_qty = 5 WHERE product_id = $1', [fx.p1]);
});

test('checkout: refuses an address that belongs to someone else', async () => {
  await as(fx.c1, async (c) => {
    await c.query('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (my_cart_id(), $1, 1)', [fx.p3]);
    await rejects(c.query(`SELECT checkout($1, 'upi')`, [fx[`a${fx.c2}`]]), '42501');
  });
});

test('concurrency: two buyers racing for the last unit => exactly one succeeds (row lock)', async () => {
  await owner.query('UPDATE products SET stock_qty = 1 WHERE product_id = $1', [fx.p2]);
  await owner.query('DELETE FROM cart_items WHERE cart_id IN (SELECT cart_id FROM carts WHERE user_id = ANY($1))', [[fx.c1, fx.c2]]);
  const attempt = async (uid, hold) => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.user_id', $1, true)`, [String(uid)]);
      await c.query('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (my_cart_id(), $1, 1)', [fx.p2]);
      await c.query(`SELECT set_config('app.demo_hold_seconds', $1, true)`, [String(hold)]);
      await c.query(`SELECT checkout($1, 'upi')`, [fx[`a${uid}`]]);
      await c.query('COMMIT');
      return 'ok';
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      return e.code;
    } finally {
      c.release();
    }
  };
  // T1 holds its row lock for 1s; T2 starts 200ms later and must wait, then fail
  const results = await Promise.all([attempt(fx.c1, 1), new Promise((r) => setTimeout(r, 200)).then(() => attempt(fx.c2, 0))]);
  assert.deepEqual(results.sort(), ['SS001', 'ok']);
  assert.equal((await owner.query('SELECT stock_qty FROM products WHERE product_id = $1', [fx.p2])).rows[0].stock_qty, 0);
});

test('cancel_order: another customer may not cancel someone else\'s order', async () => {
  const oid = (await owner.query(
    `INSERT INTO orders (user_id, address_id, status, subtotal, total_amount) VALUES ($1, $2, 'paid', 100, 100) RETURNING order_id`,
    [fx.c1, fx[`a${fx.c1}`]])).rows[0].order_id;
  await as(fx.c2, (c) => rejects(c.query('SELECT cancel_order($1)', [oid]), '42501'));
  assert.equal((await owner.query('SELECT status FROM orders WHERE order_id = $1', [oid])).rows[0].status, 'paid');
});

// ---------------------------------------------------------------- cancel & order state machine
test('cancel_order restores stock; terminal states cannot be cancelled; only the owner may cancel', async () => {
  const before = (await owner.query('SELECT stock_qty FROM products WHERE product_id = $1', [fx.p3])).rows[0].stock_qty;
  await as(fx.c1, async (c) => {
    await c.query('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (my_cart_id(), $1, 3)', [fx.p3]);
    const { rows: [{ order_id }] } = await c.query(`SELECT checkout($1, 'card') AS order_id`, [fx[`a${fx.c1}`]]);
    assert.equal((await c.query('SELECT stock_qty FROM products WHERE product_id = $1', [fx.p3])).rows[0].stock_qty, before - 3);
    await c.query('SELECT cancel_order($1)', [order_id]);
    assert.equal((await c.query('SELECT stock_qty FROM products WHERE product_id = $1', [fx.p3])).rows[0].stock_qty, before);
    assert.equal((await c.query('SELECT status FROM orders WHERE order_id = $1', [order_id])).rows[0].status, 'cancelled');
    assert.equal((await c.query('SELECT status FROM payments WHERE order_id = $1', [order_id])).rows[0].status, 'refunded');
    await rejects(c.query('SELECT cancel_order($1)', [order_id]), 'SS004'); // already cancelled
  });
});

test('order status trigger rejects illegal transitions (SS004) and records history', async () => {
  const oid = (await owner.query(
    `INSERT INTO orders (user_id, address_id, status, subtotal, total_amount) VALUES ($1, $2, 'delivered', 100, 100) RETURNING order_id`,
    [fx.c1, fx[`a${fx.c1}`]])).rows[0].order_id;
  await rejects(owner.query(`UPDATE orders SET status = 'pending' WHERE order_id = $1`, [oid]), 'SS004');
  await rejects(owner.query(`UPDATE orders SET status = 'shipped' WHERE order_id = $1`, [oid]), 'SS004');
  const o2 = (await owner.query(
    `INSERT INTO orders (user_id, address_id, status, subtotal, total_amount) VALUES ($1, $2, 'paid', 100, 100) RETURNING order_id`,
    [fx.c1, fx[`a${fx.c1}`]])).rows[0].order_id;
  await owner.query(`UPDATE orders SET status = 'shipped' WHERE order_id = $1`, [o2]);
  await owner.query(`UPDATE orders SET status = 'delivered' WHERE order_id = $1`, [o2]);
  const hist = await owner.query('SELECT old_status, new_status FROM order_status_history WHERE order_id = $1 ORDER BY history_id', [o2]);
  assert.deepEqual(hist.rows.map((r) => `${r.old_status}>${r.new_status}`), ['null>paid', 'paid>shipped', 'shipped>delivered']);
});

// ---------------------------------------------------------------- low-stock trigger
test('low-stock alert opens when stock drops below threshold and resolves on restock', async () => {
  const open = async () => (await owner.query('SELECT count(*)::int n FROM stock_alerts WHERE product_id = $1 AND resolved_at IS NULL', [fx.p1])).rows[0].n;
  await owner.query('UPDATE products SET stock_qty = 10, reorder_threshold = 3 WHERE product_id = $1', [fx.p1]);
  assert.equal(await open(), 0);
  await owner.query('UPDATE products SET stock_qty = 2 WHERE product_id = $1', [fx.p1]);
  assert.equal(await open(), 1);
  await owner.query('UPDATE products SET stock_qty = 1 WHERE product_id = $1', [fx.p1]); // still one open alert, updated in place
  assert.equal(await open(), 1);
  assert.equal((await owner.query('SELECT stock_qty FROM stock_alerts WHERE product_id = $1 AND resolved_at IS NULL', [fx.p1])).rows[0].stock_qty, 1);
  // restock via the stored procedure, as the owning seller (RLS)
  await as(fx.s1, (c) => c.query('CALL restock_product($1, 20)', [fx.p1]).then(async () => {
    assert.equal((await c.query('SELECT count(*)::int n FROM stock_alerts WHERE product_id = $1 AND resolved_at IS NULL', [fx.p1])).rows[0].n, 0);
  }));
});

// ---------------------------------------------------------------- row-level security
test('RLS: a seller cannot modify or restock another seller\'s product', async () => {
  await as(fx.s1, async (c) => {
    const r = await c.query('UPDATE products SET price = 1 WHERE product_id = $1', [fx.p2]);
    assert.equal(r.rowCount, 0); // row invisible to the UPDATE
    await rejectsSp(c, () => c.query('CALL restock_product($1, 5)', [fx.p2]), '42501');
    await rejectsSp(c, () => c.query(`INSERT INTO products (seller_id, category_id, title, price, mrp) VALUES ($1, $2, 'Impersonated listing', 10, 10)`, [fx.s2, fx.cat]), '42501');
  });
});

test('RLS: customers see only their own orders; sellers only orders containing their products; anonymous sees none', async () => {
  const oid = (await owner.query(
    `INSERT INTO orders (user_id, address_id, status, subtotal, total_amount) VALUES ($1, $2, 'paid', 800, 800) RETURNING order_id`,
    [fx.c1, fx[`a${fx.c1}`]])).rows[0].order_id;
  await owner.query('INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES ($1, $2, 1, 500), ($1, $3, 1, 300)', [oid, fx.p1, fx.p2]);
  const visible = (uid) => as(uid, async (c) => ({
    orders: (await c.query('SELECT order_id FROM orders WHERE order_id = $1', [oid])).rowCount,
    lines: (await c.query('SELECT product_id FROM order_items WHERE order_id = $1 ORDER BY 1', [oid])).rows.map((r) => r.product_id),
  }));
  assert.deepEqual(await visible(fx.c1), { orders: 1, lines: [fx.p1, fx.p2].sort((a, b) => a - b) });
  assert.deepEqual(await visible(fx.c2), { orders: 0, lines: [] });
  assert.deepEqual(await visible(null), { orders: 0, lines: [] });
  // seller 1 sees the order but only his own line; seller 2 only hers
  assert.deepEqual(await visible(fx.s1), { orders: 1, lines: [fx.p1] });
  assert.deepEqual(await visible(fx.s2), { orders: 1, lines: [fx.p2] });
  // the analytics view reflects the same restriction without any WHERE clause
  const revenue = (uid) => as(uid, async (c) => Number((await c.query('SELECT coalesce(sum(line_total), 0) AS r FROM v_sales_lines WHERE order_id = $1', [oid])).rows[0].r));
  assert.equal(await revenue(fx.s1), 500);
  assert.equal(await revenue(fx.s2), 300);
});

test('RLS: users table is private; only admins may change is_active', async () => {
  await as(fx.c1, async (c) => {
    const seen = (await c.query('SELECT user_id FROM users')).rows.map((r) => r.user_id);
    assert.deepEqual(seen, [fx.c1]);
    assert.equal((await c.query('UPDATE users SET is_active = FALSE WHERE user_id = $1', [fx.c2])).rowCount, 0);
    await rejects(c.query(`UPDATE users SET role = 'admin' WHERE user_id = $1`, [fx.c1]), '42501'); // no column privilege
  });
  await as(fx.c1, (c) => rejects(c.query('SELECT * FROM admin_monthly_revenue()'), '42501')); // admin-only function
});

// ---------------------------------------------------------------- review triggers
test('reviews: verified_purchase is computed by trigger; rating aggregates are maintained', async () => {
  const bought = (await owner.query(
    `INSERT INTO orders (user_id, address_id, status, subtotal, total_amount) VALUES ($1, $2, 'delivered', 100, 100) RETURNING order_id`,
    [fx.c1, fx[`a${fx.c1}`]])).rows[0].order_id;
  await owner.query('INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES ($1, $2, 1, 100)', [bought, fx.p3]);
  await as(fx.c1, async (c) => {
    // client tries to claim verified_purchase = true for a product it never bought; the trigger overrides it
    const a = await c.query(`INSERT INTO reviews (product_id, user_id, rating, body, verified_purchase) VALUES ($1, $2, 5, 'Bought it and loved it, great value', FALSE) RETURNING verified_purchase`, [fx.p3, fx.c1]);
    assert.equal(a.rows[0].verified_purchase, true);
    const b = await c.query(`INSERT INTO reviews (product_id, user_id, rating, body, verified_purchase) VALUES ($1, $2, 3, 'Never bought this one, just opinions', TRUE) RETURNING verified_purchase`, [fx.p4, fx.c1]);
    assert.equal(b.rows[0].verified_purchase, false);
    await rejectsSp(c, () => c.query(`INSERT INTO reviews (product_id, user_id, rating, body) VALUES ($1, $2, 4, 'A second review by the same user')`, [fx.p3, fx.c1]), 'uq_one_review_per_user_product');
    await rejectsSp(c, () => c.query(`INSERT INTO reviews (product_id, user_id, rating, body) VALUES ($1, $2, 4, 'Impersonating another customer here')`, [fx.p3, fx.c2]), '42501');
    const agg = (await c.query('SELECT avg_rating, review_count FROM products WHERE product_id = $1', [fx.p3])).rows[0];
    assert.equal(Number(agg.avg_rating), 5);
    assert.equal(agg.review_count, 1);
  });
});

// ---------------------------------------------------------------- embedding queue trigger
test('embedding queue: editing product text enqueues exactly one job; price edits do not', async () => {
  const jobs = async () => (await owner.query(`SELECT count(*)::int n FROM embedding_jobs WHERE entity_type = 'product' AND entity_id = $1 AND processed_at IS NULL`, [fx.p3])).rows[0].n;
  await owner.query(`UPDATE embedding_jobs SET processed_at = now() WHERE entity_type = 'product' AND entity_id = $1`, [fx.p3]);
  assert.equal(await jobs(), 0);
  await owner.query('UPDATE products SET price = 120, mrp = 200 WHERE product_id = $1', [fx.p3]);
  assert.equal(await jobs(), 0, 'price change must not trigger re-embedding');
  await owner.query(`UPDATE products SET description = 'a brand new description' WHERE product_id = $1`, [fx.p3]);
  await owner.query(`UPDATE products SET title = 'Renamed fixture gamma ${tag}' WHERE product_id = $1`, [fx.p3]);
  assert.equal(await jobs(), 1, 'burst of edits is de-duplicated by the partial unique index');
});

// ---------------------------------------------------------------- analytics & search
test('association rules: materialized view has pairs with lift > 1 and valid probabilities', async () => {
  const { rows } = await app.query('SELECT count(*)::int n, min(lift) AS minl, max(confidence) AS maxc, max(support) AS maxs FROM mv_product_pairs WHERE lift > 1');
  assert.ok(rows[0].n > 0, 'expected planted co-purchase pairs');
  assert.ok(Number(rows[0].maxc) <= 1 && Number(rows[0].maxs) <= 1);
  const top = (await app.query('SELECT * FROM mv_product_pairs ORDER BY lift DESC LIMIT 1')).rows[0];
  const fbt = await app.query('SELECT * FROM frequently_bought_together($1, 5)', [top.product_id]);
  assert.ok(fbt.rowCount >= 1);
});

test('full-text search (lexical mode) finds a fixture by a rare term and respects filters', async () => {
  const run = (extra = []) => app.query(`SELECT product_id FROM search_products('zzyzx', NULL, 'lexical', 10, NULL, $1, $2)`, extra);
  const all = (await run([null, null])).rows.map((r) => r.product_id);
  assert.ok(all.includes(fx.p1) && all.includes(fx.p2));
  const cheap = (await run([null, 350])).rows.map((r) => r.product_id); // max price 350
  assert.ok(!cheap.includes(fx.p1) && cheap.includes(fx.p2));
});

test('hybrid search fuses keyword + vector lists (skipped if embeddings are not built yet)', async (t) => {
  const { rows: [{ n }] } = await owner.query('SELECT count(*)::int n FROM product_embeddings');
  if (n < 100) return t.skip('run `npm run embed:all` first');
  const { rows: [any] } = await owner.query('SELECT product_id, embedding::text AS v FROM product_embeddings LIMIT 1');
  const { rows } = await app.query(`SELECT * FROM search_products('headphones', $1::vector, 'hybrid', 10)`, [any.v]);
  assert.ok(rows.length > 0 && rows.length <= 10);
  assert.ok(rows.every((r, i) => i === 0 || rows[i - 1].score >= r.score), 'results ordered by fused score');
  // querying with a product's own vector: the product must be retrieved with similarity ~1.0.
  // (Semantic mode also fuses review matches, so it need not rank first; near-duplicate listings may tie.)
  const sem = await app.query(`SELECT product_id, semantic_similarity FROM search_products('x', $1::vector, 'semantic', 20)`, [any.v]);
  const self = sem.rows.find((r) => r.product_id === any.product_id);
  assert.ok(self && self.semantic_similarity > 0.999, 'the product itself is retrieved with similarity ~1');
});

test('category helpers: recursive descendants and breadcrumb path', async () => {
  const { rows: [top] } = await owner.query('SELECT category_id FROM categories WHERE parent_id IS NULL LIMIT 1');
  const desc = await owner.query('SELECT * FROM category_descendants($1)', [top.category_id]);
  assert.ok(desc.rowCount > 1);
  const { rows: [{ category_path }] } = await owner.query('SELECT category_path($1) AS category_path', [fx.cat]);
  assert.match(category_path, / > /);
});
