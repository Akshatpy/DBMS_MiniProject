import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession, type Role } from './lib/session';

// Page-level role gates. API routes check roles themselves, and the database enforces
// row access with RLS regardless — this is only for a friendly redirect.
const GATES: [prefix: string, roles: Role[]][] = [
  ['/admin', ['admin']],
  ['/seller', ['seller']],
  ['/cart', ['customer']],
  ['/orders', ['customer']],
];

export async function middleware(req: NextRequest) {
  const gate = GATES.find(([p]) => req.nextUrl.pathname.startsWith(p));
  if (!gate) return NextResponse.next();
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    const url = new URL('/login', req.url);
    url.searchParams.set('next', req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  if (!gate[1].includes(session.role)) return NextResponse.redirect(new URL('/', req.url));
  return NextResponse.next();
}

export const config = { matcher: ['/admin/:path*', '/seller/:path*', '/cart', '/orders/:path*'] };
