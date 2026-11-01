import { NextResponse } from 'next/server';
import { withUser } from '@/lib/db';
import { handler, requireRole } from '@/lib/auth';
import { getSellerProducts } from '@/lib/data/seller';
import { ProductFields } from '@/lib/validation';

export const GET = handler(async (req: Request) => {
  const s = await requireRole('seller');
  return NextResponse.json(await getSellerProducts(s, new URL(req.url).searchParams.get('q') ?? ''));
});

// INSERT fires: trg_products_stock_alert (if below threshold) and trg_products_enqueue_embedding_ins
export const POST = handler(async (req: Request) => {
  const s = await requireRole('seller');
  const b = ProductFields.parse(await req.json());
  const row = await withUser(s, async (c) => (await c.query(
    `INSERT INTO products (seller_id, category_id, title, brand, description, features, price, mrp,
                           stock_qty, reorder_threshold, image_url, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING product_id`,
    [s.uid, b.categoryId, b.title, b.brand || null, b.description, b.features, b.price, b.mrp,
     b.stockQty, b.reorderThreshold, b.imageUrl || null, b.isActive])).rows[0]);
  return NextResponse.json(row, { status: 201 });
});
