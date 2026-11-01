import 'server-only';
import { Pool, types, type PoolClient, type DatabaseError } from 'pg';
import type { Session } from './session';

// BIGINT ids and NUMERIC money values fit comfortably in JS numbers at this scale
types.setTypeParser(20, (v) => parseInt(v, 10));
types.setTypeParser(1700, (v) => parseFloat(v));

// The web app connects as the least-privilege role `shopsense_app` (see db/07_security.sql).
// The connection string comes only from the environment.
const globalForPool = globalThis as unknown as { __shopsensePool?: Pool };

export const pool =
  globalForPool.__shopsensePool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
if (process.env.NODE_ENV !== 'production') globalForPool.__shopsensePool = pool;

/**
 * Runs `fn` inside a transaction with the end user's identity attached:
 *   set_config('app.user_id', <id>, true)   -- `true` = local to this transaction
 * Row-Level Security policies read it through app_user_id(), so every query in `fn`
 * only sees the rows this user may see. Throwing inside `fn` rolls everything back.
 */
export async function withUser<T>(session: Session | null, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [session ? String(session.uid) : '']);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Anonymous read (no user context). RLS still applies. */
export function publicQuery<T>(fn: (c: PoolClient) => Promise<T>) {
  return withUser(null, fn);
}

// ---------------------------------------------------------------------------
// Map database errors (constraints, triggers, custom SQLSTATEs) to HTTP responses.
// Validation lives in the database; the API just translates it.
// ---------------------------------------------------------------------------
const CONSTRAINT_MESSAGES: Record<string, string> = {
  uq_users_email: 'An account with this email already exists',
  uq_users_email_lower: 'An account with this email already exists',
  sellers_store_name_key: 'That store name is taken',
  uq_one_review_per_user_product: 'You have already reviewed this product',
  chk_products_mrp_ge_price: 'MRP must be greater than or equal to the selling price',
  products_price_check: 'Price must be greater than zero',
  products_stock_qty_check: 'Stock cannot be negative',
  cart_items_quantity_check: 'Quantity must be between 1 and 10',
  reviews_rating_check: 'Rating must be between 1 and 5',
  reviews_body_check: 'Review must be between 10 and 5000 characters',
  users_full_name_check: 'Name must be 2-100 characters',
};

export function dbErrorToHttp(err: unknown): { status: number; message: string; code?: string } {
  const e = err as Partial<DatabaseError>;
  const code = e.code;
  const byConstraint = e.constraint ? CONSTRAINT_MESSAGES[e.constraint] : undefined;
  switch (code) {
    case 'SS001': case 'SS002': case 'SS003': case 'SS004':
      return { status: 409, message: e.message!, code };
    case 'SS005': case '22023':
      return { status: 400, message: e.message!, code };
    case '28000':
      return { status: 401, message: 'Please sign in', code };
    case '42501':
      return { status: 403, message: e.message?.startsWith('new row violates row-level security')
        ? 'Not allowed by row-level security policy' : e.message!, code };
    case '23505':
      return { status: 409, message: byConstraint ?? 'Duplicate value', code };
    case '23514': case '23502': case '23503': case '22P02': case '22001':
      return { status: 400, message: byConstraint ?? `Invalid input (${e.constraint ?? e.message})`, code };
    default:
      if (e.message?.includes('domain')) return { status: 400, message: e.message, code };
      console.error(err);
      return { status: 500, message: 'Internal error', code };
  }
}
