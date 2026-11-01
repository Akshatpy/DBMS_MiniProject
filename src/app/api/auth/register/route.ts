import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { handler } from '@/lib/auth';
import { SESSION_COOKIE, signSession } from '@/lib/session';

const Body = z.discriminatedUnion('role', [
  z.object({
    role: z.literal('customer'),
    email: z.string().max(200), password: z.string().max(200), fullName: z.string().max(100),
    phone: z.string().max(15).optional(),
    address: z.object({
      line1: z.string().max(200), city: z.string().max(80), state: z.string().max(80), pincode: z.string().max(6),
    }),
  }),
  z.object({
    role: z.literal('seller'),
    email: z.string().max(200), password: z.string().max(200), fullName: z.string().max(100),
    phone: z.string().max(15).optional(),
    storeName: z.string().max(100), gstin: z.string().max(15).optional(),
  }),
]);

export const POST = handler(async (req: Request) => {
  const b = Body.parse(await req.json());
  // All field validation (email format, phone, pincode, GSTIN, password strength, uniqueness)
  // is enforced by database domains, constraints and register_* functions.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let uid: number;
    if (b.role === 'customer') {
      uid = (await client.query('SELECT register_customer($1, $2, $3, $4) AS id',
        [b.email, b.password, b.fullName, b.phone || null])).rows[0].id;
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [String(uid)]);
      await client.query(
        `INSERT INTO addresses (user_id, label, line1, city, state, pincode, is_default)
         VALUES ($1, 'Home', $2, $3, $4, $5, TRUE)`,
        [uid, b.address.line1, b.address.city, b.address.state, b.address.pincode]);
    } else {
      uid = (await client.query('SELECT register_seller($1, $2, $3, $4, $5, $6) AS id',
        [b.email, b.password, b.fullName, b.storeName, b.gstin || null, b.phone || null])).rows[0].id;
    }
    await client.query('COMMIT');
    const res = NextResponse.json({ uid, role: b.role }, { status: 201 });
    res.cookies.set(SESSION_COOKIE, await signSession({ uid, role: b.role, name: b.fullName.trim() }), {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 7 * 86400,
    });
    return res;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});
