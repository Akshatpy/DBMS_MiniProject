import { NextResponse } from 'next/server';
import { withUser } from '@/lib/db';
import { handler, HttpError, requireRole } from '@/lib/auth';
import { ProductFields } from '@/lib/validation';

type Ctx = { params: Promise<{ id: string }> };

// UPDATE fires: trg_products_touch, trg_products_stock_alert (stock/threshold change) and
// trg_products_enqueue_embedding_upd (only when title/brand/description/features/category changed).
// RLS (products_update policy) makes another seller's product invisible to this UPDATE.
export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const s = await requireRole('seller', 'admin');
  const id = Number((await ctx.params).id);
  const b = ProductFields.partial().parse(await req.json());
  const columns: Record<string, unknown> = {
    title: b.title, brand: b.brand, description: b.description, features: b.features, price: b.price,
    mrp: b.mrp, stock_qty: b.stockQty, reorder_threshold: b.reorderThreshold, image_url: b.imageUrl,
    category_id: b.categoryId, is_active: b.isActive,
  };
  const entries = Object.entries(columns).filter(([, v]) => v !== undefined);
  if (!entries.length) throw new HttpError(400, 'Nothing to update');

  const sets = entries.map(([col], i) => `${col} = $${i + 2}`).join(', ');
  const result = await withUser(s, (c) => c.query(
    `UPDATE products SET ${sets} WHERE product_id = $1 RETURNING product_id, stock_qty, updated_at`,
    [id, ...entries.map(([, v]) => v)]));
  if (!result.rowCount) throw new HttpError(404, 'Product not found or not owned by you');
  return NextResponse.json(result.rows[0]);
});
