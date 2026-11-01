import { SignJWT, jwtVerify } from 'jose';

export type Role = 'customer' | 'seller' | 'admin';
export interface Session {
  uid: number;
  role: Role;
  name: string;
}

export const SESSION_COOKIE = 'ss_session';
const secret = () => new TextEncoder().encode(process.env.SESSION_SECRET);

export async function signSession(s: Session): Promise<string> {
  return new SignJWT({ role: s.role, name: s.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(s.uid))
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return { uid: Number(payload.sub), role: payload.role as Role, name: String(payload.name) };
  } catch {
    return null;
  }
}
