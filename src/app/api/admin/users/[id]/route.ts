import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withUser } from '@/lib/db';
import { handler, HttpError, requireRole } from '@/lib/auth';

// Only the is_active column is granted to the app role, and the users_admin_update RLS policy
// limits UPDATE to admins: even a bug here could not change roles or passwords.
export const PATCH = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await requireRole('admin');
  const id = Number((await ctx.params).id);
  const { isActive } = z.object({ isActive: z.boolean() }).parse(await req.json());
  if (id === s.uid) throw new HttpError(400, 'You cannot deactivate yourself');
  const r = await withUser(s, (c) =>
    c.query('UPDATE users SET is_active = $2 WHERE user_id = $1 RETURNING user_id, is_active', [id, isActive]));
  if (!r.rowCount) throw new HttpError(404, 'User not found');
  return NextResponse.json(r.rows[0]);
});
