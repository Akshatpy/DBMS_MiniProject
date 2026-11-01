import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withUser } from '@/lib/db';
import { handler, requireRole } from '@/lib/auth';

const Body = z.object({
  addressId: z.number().int().positive(),
  method: z.enum(['upi', 'card', 'netbanking', 'cod']),
});

// The whole checkout (stock locks, order, items, stock decrement, payment, cart clear)
// is one atomic stored function: checkout(). Errors such as insufficient stock (SQLSTATE SS001)
// roll the transaction back and surface as HTTP 409.
export const POST = handler(async (req: Request) => {
  const s = await requireRole('customer');
  const { addressId, method } = Body.parse(await req.json());
  const orderId = await withUser(s, async (c) =>
    (await c.query('SELECT checkout($1, $2::payment_method) AS order_id', [addressId, method])).rows[0].order_id);
  return NextResponse.json({ orderId }, { status: 201 });
});
