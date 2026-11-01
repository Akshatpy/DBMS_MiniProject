import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getAdminDashboard } from '@/lib/data/admin';
import { inr, compact, monthLabel, dateTime } from '@/lib/format';
import { Kpi } from '@/components/Kpi';
import { RevenueTrendChart } from '@/components/Charts';
import { RefreshButton } from './RefreshButton';

export const dynamic = 'force-dynamic';

export default async function AdminDashboard() {
  const session = await getSession();
  if (!session || session.role !== 'admin') redirect('/login');
  const d = await getAdminDashboard(session);
  const k = d.kpis;
  const last = d.monthly.at(-1);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Platform analytics</h1>
          <p className="text-sm text-slate-500">Served from materialized views (<code>mv_daily_sales</code>, <code>mv_product_pairs</code>) through admin-only SECURITY DEFINER functions.</p>
        </div>
        <div className="ml-auto"><RefreshButton /></div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
        <Kpi label="Customers" value={compact(k.customers)} />
        <Kpi label="Sellers" value={String(k.sellers)} />
        <Kpi label="Products" value={compact(k.products)} />
        <Kpi label="Orders" value={compact(k.orders)} />
        <Kpi label="Reviews" value={compact(k.reviews)} />
        <Kpi label="Vectors stored" value={compact(k.vectors)} hint="pgvector, 384-d" />
        <Kpi label="Open stock alerts" value={String(k.open_alerts)} />
      </div>

      <div className="card p-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="font-semibold">Monthly platform revenue</h2>
          {last && <span className="text-sm text-slate-500">This month so far: {inr(last.revenue)} · cumulative {inr(last.cumulative_revenue)}</span>}
        </div>
        <p className="mb-2 text-xs text-slate-400">admin_monthly_revenue(): LAG for month-over-month growth, AVG OVER for 3-month moving average, SUM OVER for running total</p>
        <RevenueTrendChart data={d.monthly} lineKey="moving_avg_3m" lineLabel="3-month avg" height={300} />
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {d.monthly.slice(-12).map((m) => (
            <span key={m.month} className={`badge ${m.mom_growth_pct == null ? 'bg-slate-100' : m.mom_growth_pct >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
              {monthLabel(m.month)} {m.mom_growth_pct == null ? '' : `${m.mom_growth_pct > 0 ? '+' : ''}${m.mom_growth_pct}%`}
            </span>
          ))}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="card overflow-x-auto p-4">
          <h2 className="font-semibold">Revenue by category, last 12 months</h2>
          <p className="mb-2 text-xs text-slate-400">GROUP BY ROLLUP(category, sub-category): sub-category rows, category subtotals and grand total in one query</p>
          <table className="table">
            <thead><tr><th>Category</th><th className="text-right">Revenue</th><th className="text-right">Units</th><th className="text-right">Share</th></tr></thead>
            <tbody>
              {d.rollup.filter((r) => r.level !== 'subcategory').map((r, i) => (
                <tr key={i} className={r.level === 'grand total' ? 'bg-slate-50 font-semibold' : ''}>
                  <td>{r.level === 'grand total' ? 'All categories' : r.top_category}</td>
                  <td className="text-right">{inr(r.revenue)}</td>
                  <td className="text-right">{compact(r.units)}</td>
                  <td className="text-right">{r.share_pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-brand-700">Show sub-category rows ({d.rollup.filter((r) => r.level === 'subcategory').length})</summary>
            <table className="table mt-2">
              <tbody>
                {d.rollup.filter((r) => r.level === 'subcategory').map((r, i) => (
                  <tr key={i}><td className="text-slate-500">{r.top_category}</td><td>{r.sub_category}</td><td className="text-right">{inr(r.revenue)}</td></tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>

        <div className="card overflow-x-auto p-4">
          <h2 className="font-semibold">Seller leaderboard, last 6 months</h2>
          <p className="mb-2 text-xs text-slate-400">RANK() OVER overall and PARTITION BY main category · share = revenue / SUM() OVER ()</p>
          <table className="table">
            <thead><tr><th>#</th><th>Store</th><th>Main category</th><th className="text-right">Revenue</th><th className="text-right">Share</th><th className="text-right">Cat. rank</th></tr></thead>
            <tbody>
              {d.sellers.map((s) => (
                <tr key={s.seller_id}>
                  <td>{s.overall_rank}</td><td className="font-medium">{s.store_name}</td>
                  <td className="text-xs text-slate-500">{s.main_category}</td>
                  <td className="text-right">{inr(s.revenue)}</td><td className="text-right">{s.revenue_share_pct}%</td>
                  <td className="text-right">#{s.category_rank}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="card p-4">
          <h2 className="mb-2 font-semibold">Search usage by mode</h2>
          <table className="table">
            <thead><tr><th>Mode</th><th className="text-right">Searches</th><th className="text-right">Avg ms</th><th className="text-right">Zero-result</th></tr></thead>
            <tbody>{d.searchStats.map((s) => (
              <tr key={s.mode}><td className="capitalize">{s.mode}</td><td className="text-right">{s.searches}</td>
                <td className="text-right">{s.avg_latency_ms}</td><td className="text-right">{s.zero_result_pct}%</td></tr>
            ))}</tbody>
          </table>
        </div>
        <div className="card p-4">
          <h2 className="mb-2 font-semibold">Top queries</h2>
          <ul className="space-y-1 text-sm">{d.topQueries.map((q) => (
            <li key={q.query} className="flex justify-between gap-2"><span className="truncate">{q.query}</span><span className="text-slate-400">{q.n}</span></li>
          ))}</ul>
        </div>
        <div className="card p-4">
          <h2 className="mb-2 font-semibold">Zero-result queries</h2>
          <p className="mb-2 text-xs text-slate-400">Demand the catalog (or keyword search) is missing</p>
          <ul className="space-y-1 text-sm">{d.zeroResults.length === 0 ? <li className="text-slate-400">None yet</li> : d.zeroResults.map((q, i) => (
            <li key={i} className="flex justify-between gap-2"><span className="truncate">{q.query}</span><span className="badge bg-slate-100">{q.mode}</span></li>
          ))}</ul>
        </div>
      </div>

      <div className="card overflow-x-auto p-4">
        <h2 className="mb-1 font-semibold">Embedding queue</h2>
        <p className="mb-2 text-xs text-slate-400">Filled by triggers on product/review text changes; drained by the worker with FOR UPDATE SKIP LOCKED + LISTEN/NOTIFY</p>
        <table className="table">
          <thead><tr><th>Entity</th><th className="text-right">Pending</th><th className="text-right">Processed</th><th className="text-right">Failing</th><th>Last processed</th></tr></thead>
          <tbody>{d.queue.map((q) => (
            <tr key={q.entity_type}><td className="capitalize">{q.entity_type}</td><td className="text-right">{q.pending}</td>
              <td className="text-right">{compact(q.done)}</td><td className="text-right">{q.failing}</td>
              <td>{q.last_processed ? dateTime(q.last_processed) : '—'}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
