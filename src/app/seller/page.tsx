import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getSellerDashboard } from '@/lib/data/seller';
import { inr, monthLabel, date } from '@/lib/format';
import { Kpi } from '@/components/Kpi';
import { RevenueTrendChart } from '@/components/Charts';
import { FulfilButton, RestockButton } from './SellerActions';

export const dynamic = 'force-dynamic';

export default async function SellerDashboard() {
  const session = await getSession();
  if (!session || session.role !== 'seller') redirect('/login');
  const d = await getSellerDashboard(session);
  const k = d.kpis;
  const growth = k.revenue_prev_30d ? (100 * (k.revenue_30d - k.revenue_prev_30d)) / k.revenue_prev_30d : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Seller dashboard</h1>
        <p className="text-sm text-slate-500">
          Every number here comes from the same views the admin uses. PostgreSQL Row-Level Security limits them to your
          own products and order lines. The queries contain no <code>WHERE seller_id = …</code>.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi label="Revenue (30 days)" value={inr(k.revenue_30d)} delta={growth} />
        <Kpi label="Orders (30 days)" value={String(k.orders_30d)} />
        <Kpi label="Units sold (30 days)" value={String(k.units_30d)} />
        <Kpi label="Lifetime revenue" value={inr(k.revenue_all_time)} />
        <Kpi label="Active products" value={String(k.active_products)} hint={`${d.lowStock.length} low-stock alerts`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-4">
          <h2 className="font-semibold">Monthly revenue</h2>
          <p className="mb-2 text-xs text-slate-400">Bars: revenue · Line: 3-month moving average (window function)</p>
          <RevenueTrendChart data={d.monthly} lineKey="moving_avg_3m" lineLabel="3-month avg" />
        </div>
        <div className="card p-4">
          <h2 className="font-semibold">Daily revenue, last 60 days</h2>
          <p className="mb-2 text-xs text-slate-400">Gaps filled with generate_series · Line: 7-day moving average</p>
          <RevenueTrendChart data={d.daily} x="day" lineKey="ma7" lineLabel="7-day avg" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card overflow-x-auto p-4">
          <h2 className="mb-2 font-semibold">Month-over-month growth (LAG)</h2>
          <table className="table">
            <thead><tr><th>Month</th><th className="text-right">Revenue</th><th className="text-right">Orders</th><th className="text-right">MoM</th></tr></thead>
            <tbody>
              {[...d.monthly].reverse().slice(0, 8).map((m) => (
                <tr key={m.month}>
                  <td>{monthLabel(m.month)}</td>
                  <td className="text-right">{inr(m.revenue)}</td>
                  <td className="text-right">{m.orders}</td>
                  <td className={`text-right ${m.mom_growth_pct == null ? '' : m.mom_growth_pct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {m.mom_growth_pct == null ? '—' : `${m.mom_growth_pct > 0 ? '+' : ''}${m.mom_growth_pct}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card overflow-x-auto p-4">
          <h2 className="mb-2 font-semibold">Top products, last 90 days</h2>
          <table className="table">
            <thead><tr><th>#</th><th>Product</th><th className="text-right">Revenue</th><th className="text-right">Share</th><th className="text-right">Rank in category</th></tr></thead>
            <tbody>
              {d.topProducts.map((p) => (
                <tr key={p.product_id}>
                  <td>{p.overall_rank}</td>
                  <td className="max-w-56"><a href={`/product/${p.product_id}`} className="line-clamp-1 hover:text-brand-700">{p.product_title}</a>
                    <div className="text-xs text-slate-400">{p.category}</div></td>
                  <td className="text-right">{inr(p.revenue)}</td>
                  <td className="text-right">{p.share_pct}%</td>
                  <td className="text-right">#{p.category_rank}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card overflow-x-auto p-4">
          <h2 className="mb-1 font-semibold">Low-stock alerts</h2>
          <p className="mb-2 text-xs text-slate-400">Raised by trigger <code>trg_products_stock_alert</code> when stock falls below your threshold; resolved automatically on restock.</p>
          {d.lowStock.length === 0 ? <p className="text-sm text-slate-500">All stocked up.</p> : (
            <table className="table">
              <thead><tr><th>Product</th><th className="text-right">Stock</th><th className="text-right">Threshold</th><th>Since</th><th /></tr></thead>
              <tbody>
                {d.lowStock.map((a) => (
                  <tr key={a.alert_id}>
                    <td className="max-w-52"><span className="line-clamp-2">{a.title}</span></td>
                    <td className={`text-right font-semibold ${a.stock_qty === 0 ? 'text-rose-600' : 'text-amber-600'}`}>{a.stock_qty}</td>
                    <td className="text-right">{a.reorder_threshold}</td>
                    <td className="whitespace-nowrap text-xs">{date(a.alert_raised_at)}</td>
                    <td><RestockButton productId={a.product_id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card overflow-x-auto p-4">
          <h2 className="mb-1 font-semibold">Orders to fulfil</h2>
          <p className="mb-2 text-xs text-slate-400">Only your lines in each order are visible. Illegal status jumps are rejected by trigger.</p>
          {d.toFulfil.length === 0 ? <p className="text-sm text-slate-500">Nothing pending.</p> : (
            <table className="table">
              <thead><tr><th>Order</th><th>Items</th><th className="text-right">Your amount</th><th>Status</th><th /></tr></thead>
              <tbody>
                {d.toFulfil.map((o) => (
                  <tr key={o.order_id}>
                    <td className="whitespace-nowrap">#{o.order_id}<div className="text-xs text-slate-400">{date(o.placed_at)}</div></td>
                    <td className="max-w-52 text-xs">{o.lines.map((l: { title: string; quantity: number }, i: number) => <div key={i} className="line-clamp-1">{l.quantity}× {l.title}</div>)}</td>
                    <td className="text-right">{inr(o.seller_amount)}</td>
                    <td className="capitalize">{o.status}</td>
                    <td><FulfilButton orderId={o.order_id} status={o.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
