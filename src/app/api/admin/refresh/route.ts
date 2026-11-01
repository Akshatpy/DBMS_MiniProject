import { NextResponse } from 'next/server';
import { withUser } from '@/lib/db';
import { handler, requireRole } from '@/lib/auth';

// CALL refresh_analytics(): REFRESH MATERIALIZED VIEW CONCURRENTLY for both MVs + taste profiles
export const POST = handler(async () => {
  const s = await requireRole('admin');
  const t0 = performance.now();
  await withUser(s, (c) => c.query('CALL refresh_analytics()'));
  return NextResponse.json({ ok: true, ms: Math.round(performance.now() - t0) });
});
