export function Kpi({ label, value, delta, hint }: { label: string; value: string; delta?: number | null; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
      {delta != null && Number.isFinite(delta) && (
        <div className={`text-xs ${delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}% vs previous 30 days
        </div>
      )}
      {hint && <div className="text-xs text-slate-400">{hint}</div>}
    </div>
  );
}
