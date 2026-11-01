import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withUser } from '@/lib/db';
import { handler, requireRole } from '@/lib/auth';

// Calls the stored PROCEDURE restock_product (CALL ...). It runs with the caller's rights,
// so RLS stops a seller from restocking someone else's product.
export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await requireRole('seller');
  const id = Number((await ctx.params).id);
  const { quantity } = z.object({ quantity: z.number().int() }).parse(await req.json());
  const row = await withUser(s, async (c) => {
    await c.query('CALL restock_product($1, $2)', [id, quantity]);
    return (await c.query('SELECT stock_qty FROM products WHERE product_id = $1', [id])).rows[0];
  });
  return NextResponse.json(row);
});
