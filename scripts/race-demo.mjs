// Command-line version of the concurrency lab (also available at /admin/lab).
// Two connections race to buy the last unit, first with a naive read-then-write, then with checkout().
import pg from 'pg';

const owner = new pg.Pool({ connectionString: process.env.OWNER_DATABASE_URL, max: 6 });
const app = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 6 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (m) => console.log(`${String(Date.now() - t0).padStart(5)} ms  ${m}`);

const { rows: [lab] } = await owner.query(`SELECT product_id FROM products WHERE asin = 'LAB-LAST-UNIT'`);
const buyers = (await owner.query(
  `SELECT u.user_id, u.full_name, a.address_id FROM users u JOIN addresses a ON a.user_id = u.user_id AND a.is_default
    WHERE u.email IN ('lab.buyer1@shopsense.dev', 'lab.buyer2@shopsense.dev') ORDER BY u.email`)).rows;
const stock = async () => (await owner.query('SELECT stock_qty FROM products WHERE product_id = $1', [lab.product_id])).rows[0].stock_qty;
const reset = () => owner.query('UPDATE products SET stock_qty = 1 WHERE product_id = $1', [lab.product_id]);

console.log('\n=== Round 1: UNSAFE (read stock, think, write stock - 1; no lock) ===');
await reset();
const unsafe = async (name, delay) => {
  await sleep(delay);
  const c = await owner.connect();
  try {
    await c.query('BEGIN');
    const { rows: [{ stock_qty }] } = await c.query('SELECT stock_qty FROM products WHERE product_id = $1', [lab.product_id]);
    log(`${name}: read stock = ${stock_qty}`);
    await sleep(1000);
    if (stock_qty < 1) { log(`${name}: rejected`); await c.query('ROLLBACK'); return 0; }
    await c.query('UPDATE products SET stock_qty = $2 WHERE product_id = $1', [lab.product_id, stock_qty - 1]);
    await c.query('COMMIT');
    log(`${name}: SOLD, wrote stock = ${stock_qty - 1}`);
    return 1;
  } finally { c.release(); }
};
const sold = (await Promise.all([unsafe('T1', 0), unsafe('T2', 300)])).reduce((a, b) => a + b, 0);
console.log(`=> units sold: ${sold}, stock left: ${await stock()}  ${sold > 1 ? '(OVERSOLD: lost update)' : ''}\n`);

console.log('=== Round 2: SAFE (checkout() locks the row with SELECT ... FOR UPDATE) ===');
await reset();
await owner.query('DELETE FROM cart_items WHERE cart_id IN (SELECT cart_id FROM carts WHERE user_id = ANY($1))', [buyers.map((b) => b.user_id)]);
const safe = async (b, name, delay, hold) => {
  await sleep(delay);
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.user_id', $1, true)`, [String(b.user_id)]);
    await c.query('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (my_cart_id(), $1, 1)', [lab.product_id]);
    await c.query(`SELECT set_config('app.demo_hold_seconds', $1, true)`, [String(hold)]);
    log(`${name}: calling checkout()`);
    const { rows: [{ order_id }] } = await c.query(`SELECT checkout($1, 'upi') AS order_id`, [b.address_id]);
    await c.query('COMMIT');
    log(`${name}: order #${order_id} created`);
    return order_id;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    log(`${name}: FAILED  [${e.code}] ${e.message}`);
    return null;
  } finally { c.release(); }
};
const orders = (await Promise.all([safe(buyers[0], 'T1', 0, 1.5), safe(buyers[1], 'T2', 300, 0)])).filter(Boolean);
console.log(`=> orders created: ${orders.length}, stock left: ${await stock()}\n`);

// clean up: cancel the winning order so the demo can be re-run
for (const id of orders) {
  const c = await app.connect();
  await c.query('BEGIN');
  await c.query(`SELECT set_config('app.user_id', (SELECT user_id::text FROM orders WHERE order_id = $1), true)`, [id]);
  await c.query('SELECT cancel_order($1)', [id]);
  await c.query('COMMIT');
  c.release();
}
await reset();
await owner.end();
await app.end();
