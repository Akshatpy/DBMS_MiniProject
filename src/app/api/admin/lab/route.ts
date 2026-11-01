import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withUser } from '@/lib/db';
import { handler, requireRole } from '@/lib/auth';
import type { Session } from '@/lib/session';

interface TxLog {
  tx: string;
  startedMs: number;
  finishedMs: number;
  outcome: 'success' | 'failed';
  detail: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Concurrency lab: two transactions try to buy the single remaining unit at the same time.
 *  - safe:   both run the real checkout() which locks the product row (SELECT ... FOR UPDATE).
 *            T2 blocks until T1 commits, then sees stock = 0 and fails with SS001.
 *  - unsafe: both run demo_unsafe_purchase() which reads without a lock and writes back a value
 *            computed from the stale read -> classic lost update, one unit sold twice.
 */
export const POST = handler(async (req: Request) => {
  const admin = await requireRole('admin');
  const { mode } = z.object({ mode: z.enum(['safe', 'unsafe']) }).parse(await req.json());

  const productId: number = await withUser(admin, async (c) =>
    (await c.query('SELECT demo_reset_lab_product() AS id')).rows[0].id);

  const t0 = performance.now();
  const at = () => Math.round(performance.now() - t0);
  const logs: TxLog[] = [];
  const run = async (tx: string, delayMs: number, work: () => Promise<string>) => {
    await sleep(delayMs);
    const startedMs = at();
    try {
      const detail = await work();
      logs.push({ tx, startedMs, finishedMs: at(), outcome: 'success', detail });
    } catch (e) {
      logs.push({ tx, startedMs, finishedMs: at(), outcome: 'failed', detail: (e as Error).message });
    }
  };

  let cleanup = '';
  const readStock = () => withUser(admin, async (c) =>
    (await c.query('SELECT stock_qty FROM products WHERE product_id = $1', [productId])).rows[0].stock_qty as number);
  let finalStock = 0;
  if (mode === 'safe') {
    const buyers = await withUser(admin, async (c) => (await c.query<{ user_id: number; address_id: number; full_name: string }>(
      `SELECT u.user_id, a.address_id, u.full_name
         FROM users u JOIN addresses a ON a.user_id = u.user_id AND a.is_default
        WHERE u.email IN ('lab.buyer1@shopsense.dev', 'lab.buyer2@shopsense.dev')
        ORDER BY u.email`)).rows);
    const sessions: Session[] = buyers.map((b) => ({ uid: b.user_id, role: 'customer', name: b.full_name }));
    for (const s of sessions) {
      await withUser(s, async (c) => {
        await c.query('DELETE FROM cart_items');
        await c.query('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (my_cart_id(), $1, 1)', [productId]);
      });
    }
    const checkout = (s: Session, holdSeconds: number) => () => withUser(s, async (c) => {
      await c.query(`SELECT set_config('app.demo_hold_seconds', $1, true)`, [String(holdSeconds)]);
      const { rows } = await c.query(`SELECT checkout($1, 'upi') AS order_id`, [buyers.find((b) => b.user_id === s.uid)!.address_id]);
      return `order #${rows[0].order_id} created`;
    });
    await Promise.all([
      run(`T1 (${buyers[0].full_name})`, 0, checkout(sessions[0], 1.5)),
      run(`T2 (${buyers[1].full_name})`, 300, checkout(sessions[1], 0)),
    ]);
    finalStock = await readStock(); // measure the outcome BEFORE cleanup restores the unit
    // undo the winning order so the lab can be re-run (cancel_order restores the stock)
    const winner = logs.find((l) => l.outcome === 'success');
    const orderId = winner?.detail.match(/#(\d+)/)?.[1];
    if (orderId) {
      await withUser(admin, (c) => c.query('SELECT cancel_order($1)', [Number(orderId)]));
      cleanup = `Cleanup: order #${orderId} cancelled by admin (stock restored).`;
    }
  } else {
    const unsafe = () => withUser(admin, async (c) =>
      (await c.query('SELECT demo_unsafe_purchase($1, 1.5) AS r', [productId])).rows[0].r as string);
    await Promise.all([run('T1', 0, unsafe), run('T2', 300, unsafe)]);
    finalStock = await readStock();
  }

  logs.sort((a, b) => a.startedMs - b.startedMs);
  const sold = logs.filter((l) => l.outcome === 'success' && !l.detail.startsWith('rejected')).length;
  return NextResponse.json({ mode, productId, logs, unitsSold: sold, initialStock: 1, finalStock, cleanup });
});
