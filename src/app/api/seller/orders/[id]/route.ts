import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withUser } from '@/lib/db';
import { handler, HttpError, requireRole } from '@/lib/auth';

// Fulfilment: paid -> shipped -> delivered. RLS allows the update only for orders that contain
// this seller's products; the trg_orders_status_guard trigger rejects illegal transitions
// and trg_orders_status_history records the change.
export const PATCH = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await requireRole('seller', 'admin');
  const id = Number((await ctx.params).id);
  const { status } = z.object({ status: z.enum(['paid', 'shipped', 'delivered']) }).parse(await req.json());
  const result = await withUser(s, (c) =>
    c.query('UPDATE orders SET status = $2 WHERE order_id = $1 RETURNING order_id, status', [id, status]));
  if (!result.rowCount) throw new HttpError(404, 'Order not found');
  return NextResponse.json(result.rows[0]);
});
