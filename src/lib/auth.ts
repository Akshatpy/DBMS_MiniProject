import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySession, type Role, type Session } from './session';
import { dbErrorToHttp } from './db';

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** For route handlers: returns the session or throws 401/403. */
export async function requireRole(...roles: Role[]): Promise<Session> {
  const s = await getSession();
  if (!s) throw new HttpError(401, 'Please sign in');
  if (roles.length && !roles.includes(s.role)) throw new HttpError(403, 'Not allowed for your role');
  return s;
}

/** Wraps a route handler: converts HttpError and database errors to JSON responses. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
      if (err && typeof err === 'object' && 'issues' in err) {
        const issues = (err as { issues: { path: (string | number)[]; message: string }[] }).issues;
        return NextResponse.json({ error: issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, { status: 400 });
      }
      const { status, message, code } = dbErrorToHttp(err);
      return NextResponse.json({ error: message, code }, { status });
    }
  };
}
