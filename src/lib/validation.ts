import { z } from 'zod';

// Shape checks only. Value rules (price > 0, mrp >= price, stock >= 0, title length, URL format)
// are enforced by CHECK constraints in the database.
export const ProductFields = z.object({
  title: z.string().max(300),
  brand: z.string().max(120).nullable().optional(),
  description: z.string().max(5000).default(''),
  features: z.string().max(5000).default(''),
  price: z.number(),
  mrp: z.number(),
  stockQty: z.number().int(),
  reorderThreshold: z.number().int(),
  imageUrl: z.string().max(1000).nullable().optional(),
  categoryId: z.number().int(),
  isActive: z.boolean().default(true),
});
