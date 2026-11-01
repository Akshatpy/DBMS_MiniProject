import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getOrders } from '@/lib/data/shop';
import { inr, dateTime } from '@/lib/format';
import { CancelButton } from './CancelButton';

export const dynamic = 'force-dynamic';

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-700', paid: 'bg-sky-100 text-sky-800', shipped: 'bg-violet-100 text-violet-800',
  delivered: 'bg-emerald-100 text-emerald-800', cancelled: 'bg-rose-100 text-rose-700',
};

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ placed?: string }> }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/orders');
  const { placed } = await searchParams;
  const orders = await getOrders(session);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Your orders</h1>
      {placed && <div className="rounded-lg bg-emerald-50 p-3 text-emerald-800">Order #{placed} placed successfully.</div>}
      {orders.length === 0 && <p className="text-slate-500">No orders yet.</p>}
      {orders.map((o) => (
        <div key={o.order_id} className="card p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-semibold">Order #{o.order_id}</span>
            <span className={`badge capitalize ${STATUS_STYLE[o.status]}`}>{o.status}</span>
            <span className="text-sm text-slate-500">{dateTime(o.placed_at)} · {o.payment_method?.toUpperCase()} ({o.payment_status}) · to {o.city} {o.pincode}</span>
            <span className="ml-auto font-semibold">{inr(o.total_amount)}</span>
            {['pending', 'paid'].includes(o.status) && <CancelButton orderId={o.order_id} />}
          </div>
          <ul className="mt-3 space-y-2">
            {o.items.map((i: { product_id: number; title: string; image_url: string | null; quantity: number; line_total: number }) => (
              <li key={i.product_id} className="flex items-center gap-3 text-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {i.image_url && <img src={i.image_url} alt="" className="h-10 w-10 object-contain" />}
                <a href={`/product/${i.product_id}`} className="flex-1 truncate hover:text-brand-700">{i.title}</a>
                <span className="text-slate-500">× {i.quantity}</span>
                <span className="w-20 text-right">{inr(i.line_total)}</span>
              </li>
            ))}
          </ul>
          {o.timeline && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-2 text-xs text-slate-400">
              {o.timeline.map((t: { status: string; at: string }, k: number) => (
                <span key={k}><span className="capitalize text-slate-600">{t.status}</span> {dateTime(t.at)}</span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
