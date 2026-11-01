import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { handler } from '@/lib/auth';
import { SESSION_COOKIE, signSession, type Role } from '@/lib/session';

const Body = z.object({ email: z.string().min(3).max(200), password: z.string().min(1).max(200) });

export const POST = handler(async (req: Request) => {
  const { email, password } = Body.parse(await req.json());
  // Password verification happens inside PostgreSQL (pgcrypto crypt()); the app never sees the hash
  const { rows } = await pool.query<{ user_id: number; full_name: string; role: Role }>(
    'SELECT * FROM authenticate($1, $2)', [email, password]);
  if (!rows[0]) return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });

  const user = rows[0];
  const res = NextResponse.json({ uid: user.user_id, role: user.role, name: user.full_name });
  res.cookies.set(SESSION_COOKIE, await signSession({ uid: user.user_id, role: user.role, name: user.full_name }), {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 7 * 86400,
  });
  return res;
});
