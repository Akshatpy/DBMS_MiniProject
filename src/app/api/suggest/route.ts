import { NextResponse } from 'next/server';
import { handler } from '@/lib/auth';
import { suggestTitles } from '@/lib/data/search';

export const GET = handler(async (req: Request) => {
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 100);
  if (q.length < 3) return NextResponse.json([]);
  return NextResponse.json(await suggestTitles(q));
});
