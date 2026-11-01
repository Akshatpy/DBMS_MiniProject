import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession, handler } from '@/lib/auth';
import { searchProducts } from '@/lib/data/search';

const num = z.coerce.number().optional();
const Query = z.object({
  q: z.string().min(1).max(500),
  mode: z.enum(['lexical', 'semantic', 'hybrid']).default('hybrid'),
  category: z.coerce.number().int().optional(),
  minPrice: num, maxPrice: num, minRating: num,
  inStock: z.enum(['1', 'true']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});

// GET /api/search?q=gift+for+a+gardener&mode=hybrid&maxPrice=1500
export const GET = handler(async (req: Request) => {
  const p = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const result = await searchProducts(await getSession(), {
    q: p.q, mode: p.mode, categoryId: p.category, minPrice: p.minPrice, maxPrice: p.maxPrice,
    minRating: p.minRating, inStock: !!p.inStock, limit: p.limit,
  });
  return NextResponse.json(result);
});
