import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getEvalRuns } from '@/lib/data/admin';
import { dateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

const ORDER = ['lexical', 'semantic', 'hybrid'];
const LABEL: Record<string, string> = { lexical: 'Keyword (full-text)', semantic: 'Semantic (vectors)', hybrid: 'Hybrid (RRF)' };
const METRICS = [
  ['ndcg_at_k', 'nDCG@10'], ['precision_at_k', 'Precision@10'], ['recall_at_k', 'Recall@10'], ['mrr', 'MRR'],
] as const;

interface PerQuery { query: string; type: string; relevant: number; ndcg: number; p: number; rr: number }

export default async function SearchQuality() {
  const session = await getSession();
  if (!session || session.role !== 'admin') redirect('/login');
  const runs = (await getEvalRuns(session)).sort((a, b) => ORDER.indexOf(a.mode) - ORDER.indexOf(b.mode));

  if (!runs.length) {
    return <div className="card p-8 text-slate-600">No evaluation runs yet. Run <code>npm run eval</code>.</div>;
  }

  const perQuery = new Map<string, Record<string, PerQuery>>();
  for (const r of runs) for (const pq of (r.details.perQuery ?? []) as PerQuery[]) {
    perQuery.set(pq.query, { ...(perQuery.get(pq.query) ?? {}), [r.mode]: pq });
  }
  const byType = (mode: string, type: string) => (runs.find((r) => r.mode === mode)?.details.byType?.[type]?.ndcg ?? 0) as number;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Search quality benchmark</h1>
        <p className="text-sm text-slate-500">
          {runs[0].query_count} labelled queries · model {runs[0].model} · k = {runs[0].k} · last run {dateTime(runs[0].run_at)}.
          Relevance labels are defined per query as SQL predicates over category and title/description terms
          (see <code>eval/queries.json</code>).
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {runs.map((r) => (
          <div key={r.mode} className={`card p-5 ${r.mode === 'hybrid' ? 'ring-2 ring-brand-500' : ''}`}>
            <div className="mb-3 font-semibold">{LABEL[r.mode]}</div>
            {METRICS.map(([key, label]) => (
              <div key={key} className="mb-2">
                <div className="flex justify-between text-sm"><span>{label}</span><span className="font-semibold">{Number(r[key]).toFixed(3)}</span></div>
                <div className="h-2 rounded bg-slate-100"><div className="h-2 rounded bg-brand-500" style={{ width: `${100 * r[key]}%` }} /></div>
              </div>
            ))}
            <div className="mt-3 text-xs text-slate-400">avg latency {r.avg_latency_ms} ms (incl. query embedding)</div>
          </div>
        ))}
      </div>

      <div className="card overflow-x-auto p-4">
        <h2 className="mb-2 font-semibold">nDCG@10 by query type</h2>
        <table className="table">
          <thead><tr><th>Query type</th>{ORDER.map((m) => <th key={m} className="text-right">{LABEL[m]}</th>)}</tr></thead>
          <tbody>
            {['natural_language', 'exact'].map((t) => (
              <tr key={t}>
                <td>{t === 'exact' ? 'Exact / product-name queries' : 'Natural-language intent queries'}</td>
                {ORDER.map((m) => <td key={m} className="text-right">{byType(m, t).toFixed(3)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card overflow-x-auto p-4">
        <h2 className="mb-2 font-semibold">Per-query nDCG@10</h2>
        <table className="table">
          <thead><tr><th>Query</th><th>Type</th><th className="text-right">Relevant</th>{ORDER.map((m) => <th key={m} className="text-right">{m}</th>)}<th /></tr></thead>
          <tbody>
            {[...perQuery.entries()].map(([q, m]) => {
              const best = Math.max(...ORDER.map((k) => m[k]?.ndcg ?? 0));
              return (
                <tr key={q}>
                  <td>{q}</td>
                  <td className="text-xs text-slate-500">{m.hybrid?.type}</td>
                  <td className="text-right">{m.hybrid?.relevant}</td>
                  {ORDER.map((k) => (
                    <td key={k} className={`text-right ${m[k]?.ndcg === best && best > 0 ? 'font-semibold text-emerald-700' : ''}`}>
                      {(m[k]?.ndcg ?? 0).toFixed(2)}
                    </td>
                  ))}
                  <td><Link className="text-xs text-brand-700 underline" href={`/search?q=${encodeURIComponent(q)}&compare=1`}>compare</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
