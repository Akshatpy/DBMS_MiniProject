import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withUser } from '@/lib/db';
import { handler, requireRole } from '@/lib/auth';
import { getCart } from '@/lib/data/shop';

const Item = z.object({ productId: z.number().int().positive(), quantity: z.number().int() });

export const GET = handler(async () => {
  const s = await requireRole('customer');
  return NextResponse.json(await getCart(s));
});

// Add to cart (increments if already present). Stock & quantity limits are enforced by
// the trg_cart_items_validate trigger and the quantity CHECK constraint.
export const POST = handler(async (req: Request) => {
  const s = await requireRole('customer');
  const { productId, quantity } = Item.parse(await req.json());
  await withUser(s, (c) => c.query(
    `INSERT INTO cart_items (cart_id, product_id, quantity)
     VALUES (my_cart_id(), $1, $2)
     ON CONFLICT (cart_id, product_id) DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity`,
    [productId, quantity]));
  return NextResponse.json({ ok: true });
});

export const PATCH = handler(async (req: Request) => {
  const s = await requireRole('customer');
  const { productId, quantity } = Item.parse(await req.json());
  await withUser(s, (c) => c.query(
    'UPDATE cart_items SET quantity = $2 WHERE product_id = $1', [productId, quantity]));
  return NextResponse.json({ ok: true });
});

export const DELETE = handler(async (req: Request) => {
  const s = await requireRole('customer');
  const productId = Number(new URL(req.url).searchParams.get('productId'));
  // RLS scopes this DELETE to the caller's own cart
  await withUser(s, (c) => c.query('DELETE FROM cart_items WHERE product_id = $1', [productId]));
  return NextResponse.json({ ok: true });
});
