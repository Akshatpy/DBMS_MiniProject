import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withUser } from '@/lib/db';
import { handler, requireRole } from '@/lib/auth';

const Body = z.object({
  productId: z.number().int().positive(),
  rating: z.number().int(),
  title: z.string().max(200).optional(),
  body: z.string().max(5000),
});

// verified_purchase is computed by trigger; the rating aggregate is recomputed by a statement trigger;
// another trigger queues the review for embedding so it becomes searchable within seconds.
export const POST = handler(async (req: Request) => {
  const s = await requireRole('customer');
  const b = Body.parse(await req.json());
  const row = await withUser(s, async (c) => (await c.query(
    `INSERT INTO reviews (product_id, user_id, rating, title, body)
     VALUES ($1, $2, $3, $4, $5) RETURNING review_id, verified_purchase`,
    [b.productId, s.uid, b.rating, b.title || null, b.body])).rows[0]);
  return NextResponse.json(row, { status: 201 });
});
