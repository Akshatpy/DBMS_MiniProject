import { NextResponse } from 'next/server';
import { withUser } from '@/lib/db';
import { handler, requireRole } from '@/lib/auth';

export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await requireRole('customer', 'admin');
  const { id } = await ctx.params;
  await withUser(s, (c) => c.query('SELECT cancel_order($1)', [Number(id)]));
  return NextResponse.json({ ok: true });
});
