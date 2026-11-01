import 'server-only';
import { withUser } from '../db';
import type { Session } from '../session';
import type { ProductCard } from './types';

export async function getCart(session: Session) {
  return withUser(session, async (c) => {
    const [items, addresses] = await Promise.all([
      c.query<ProductCard & { quantity: number }>(
        `SELECT v.*, ci.quantity
           FROM cart_items ci JOIN v_product_cards v USING (product_id)
          ORDER BY ci.added_at`),            // RLS: only this user's cart rows are visible
      c.query<{ address_id: number; label: string; line1: string; city: string; state: string; pincode: string; is_default: boolean }>(
        `SELECT address_id, label, line1, city, state, pincode, is_default
           FROM addresses ORDER BY is_default DESC, address_id`),
    ]);
    return { items: items.rows, addresses: addresses.rows };
  });
}

export async function getOrders(session: Session) {
  return withUser(session, async (c) => {
    const { rows } = await c.query(
      `SELECT o.order_id, o.status, o.subtotal, o.shipping_fee, o.total_amount, o.placed_at,
              pay.method AS payment_method, pay.status AS payment_status,
              a.city, a.pincode,
              json_agg(json_build_object(
                'product_id', oi.product_id, 'title', p.title, 'image_url', p.image_url,
                'quantity', oi.quantity, 'unit_price', oi.unit_price, 'line_total', oi.line_total)
                ORDER BY oi.product_id) AS items,
              (SELECT json_agg(json_build_object('status', h.new_status, 'at', h.changed_at) ORDER BY h.changed_at)
                 FROM order_status_history h WHERE h.order_id = o.order_id) AS timeline
         FROM orders o
         JOIN order_items oi USING (order_id)
         JOIN products p     ON p.product_id = oi.product_id
         JOIN addresses a    ON a.address_id = o.address_id
         LEFT JOIN payments pay ON pay.order_id = o.order_id
        WHERE o.user_id = $1
        GROUP BY o.order_id, pay.method, pay.status, a.city, a.pincode
        ORDER BY o.placed_at DESC
        LIMIT 50`, [session.uid]);
    return rows;
  });
}
