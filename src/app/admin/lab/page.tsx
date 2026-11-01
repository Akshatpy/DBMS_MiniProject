'use client';

import { useState } from 'react';

interface TxLog { tx: string; startedMs: number; finishedMs: number; outcome: 'success' | 'failed'; detail: string }
interface RaceResult { mode: string; logs: TxLog[]; unitsSold: number; initialStock: number; finalStock: number; cleanup: string }

const PLANS = [
  ['vector_hnsw', 'Vector KNN with HNSW index'],
  ['vector_exact', 'Vector KNN, exact scan'],
  ['fts_gin', 'Full-text with GIN index'],
  ['fts_seq', 'Full-text, sequential scan'],
  ['hybrid', 'Hybrid search_products()'],
] as const;

function Timeline({ r }: { r: RaceResult }) {
  const max = Math.max(...r.logs.map((l) => l.finishedMs), 1);
  const oversold = r.unitsSold > r.initialStock;
  return (
    <div className="space-y-3">
      {r.logs.map((l) => (
        <div key={l.tx}>
          <div className="mb-1 flex justify-between text-xs">
            <span className="font-medium">{l.tx}</span>
            <span className="text-slate-500">{l.startedMs}–{l.finishedMs} ms</span>
          </div>
          <div className="relative h-6 rounded bg-slate-100">
            <div className={`absolute h-6 rounded ${l.outcome === 'success' && !l.detail.startsWith('rejected') ? 'bg-emerald-400' : 'bg-rose-400'}`}
              style={{ left: `${(100 * l.startedMs) / max}%`, width: `${Math.max(1, (100 * (l.finishedMs - l.startedMs)) / max)}%` }} />
          </div>
          <div className={`mt-1 text-xs ${l.outcome === 'success' ? 'text-slate-600' : 'text-rose-600'}`}>{l.detail}</div>
        </div>
      ))}
      <div className={`rounded-lg p-3 text-sm ${oversold ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'}`}>
        Stock before: {r.initialStock} · Units sold: <b>{r.unitsSold}</b> · Stock after: {r.finalStock}
        {oversold ? ' → OVERSOLD: lost update anomaly' : ' → consistent'}
      </div>
      {r.cleanup && <p className="text-xs text-slate-400">{r.cleanup}</p>}
    </div>
  );
}

export default function LabPage() {
  const [race, setRace] = useState<Record<string, RaceResult | string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [plan, setPlan] = useState<string>('vector_hnsw');
  const [q, setQ] = useState('wireless noise cancelling headphones');
  const [explain, setExplain] = useState<{ label: string; executionTime?: string; lines: string[] } | null>(null);

  async function runRace(mode: 'safe' | 'unsafe') {
    setBusy(mode);
    const res = await fetch('/api/admin/lab', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
    const data = await res.json();
    setRace((r) => ({ ...r, [mode]: res.ok ? data : data.error }));
    setBusy(null);
  }

  async function runExplain() {
    setBusy('explain');
    const res = await fetch(`/api/admin/explain?plan=${plan}&q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setExplain(res.ok ? data : { label: 'Error', lines: [data.error] });
    setBusy(null);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Database lab</h1>
        <p className="text-sm text-slate-500">Live demonstrations of transaction isolation and index behaviour on the running database.</p>
      </div>

      <section className="card p-5">
        <h2 className="text-lg font-semibold">Concurrency: two buyers, one unit left</h2>
        <p className="mb-4 text-sm text-slate-500">
          The lab product is reset to <b>stock = 1</b>. Two transactions start 300 ms apart and both try to buy it.
          T1 holds the transaction open for 1.5 s.
        </p>
        <div className="grid gap-6 md:grid-cols-2">
          {(['unsafe', 'safe'] as const).map((m) => (
            <div key={m} className="space-y-3">
              <div className="flex items-center gap-3">
                <button className={m === 'safe' ? 'btn-primary' : 'btn-danger'} disabled={!!busy} onClick={() => runRace(m)}>
                  {busy === m ? 'Running…' : m === 'safe' ? 'Run SAFE checkout()' : 'Run UNSAFE read-then-write'}
                </button>
              </div>
              <p className="text-xs text-slate-500">
                {m === 'safe'
                  ? 'checkout() locks the product row with SELECT … FOR UPDATE. T2 blocks until T1 commits, then reads stock = 0 and is rejected (SQLSTATE SS001).'
                  : 'demo_unsafe_purchase() reads stock with no lock, waits, then writes stock = read − 1. Both transactions read 1, so both sell.'}
              </p>
              {typeof race[m] === 'string' && <p className="text-sm text-rose-600">{race[m] as string}</p>}
              {typeof race[m] === 'object' && <Timeline r={race[m] as RaceResult} />}
            </div>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-semibold">Query plans: EXPLAIN (ANALYZE, BUFFERS)</h2>
        <p className="mb-4 text-sm text-slate-500">Run the same query with and without its index to see the plan and the measured execution time.</p>
        <div className="flex flex-wrap gap-2">
          <select className="input w-auto" value={plan} onChange={(e) => setPlan(e.target.value)}>
            {PLANS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input className="input flex-1" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn-primary" disabled={!!busy} onClick={runExplain}>{busy === 'explain' ? 'Running…' : 'Explain'}</button>
        </div>
        {explain && (
          <div className="mt-4">
            <div className="mb-2 text-sm font-medium">{explain.label} {explain.executionTime && <span className="badge ml-2 bg-brand-100 text-brand-700">{explain.executionTime}</span>}</div>
            <pre className="max-h-96 overflow-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">{explain.lines.join('\n')}</pre>
          </div>
        )}
      </section>
    </div>
  );
}
