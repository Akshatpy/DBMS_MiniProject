'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

const MODES = [
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'semantic', label: 'Semantic' },
  { value: 'lexical', label: 'Keyword' },
];

export function SearchBar({ large = false }: { large?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [mode, setMode] = useState(params.get('mode') ?? 'hybrid');
  const [suggestions, setSuggestions] = useState<{ product_id: number; title: string }[]>([]);
  const [open, setOpen] = useState(false);

  // typo-tolerant title suggestions (pg_trgm) after a short pause in typing
  useEffect(() => {
    if (q.trim().length < 3) { setSuggestions([]); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`);
      if (res.ok) setSuggestions(await res.json());
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(q.trim())}&mode=${mode}`);
  }

  return (
    <form onSubmit={submit} className="relative flex w-full gap-2">
      <div className="relative flex-1">
        <input
          className={`input ${large ? 'py-3 text-base' : ''}`}
          placeholder='Try "gift for a dad who loves gardening" or "quiet keyboard for night typing"'
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          aria-label="Search products"
        />
        {open && suggestions.length > 0 && (
          <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            {suggestions.map((s) => (
              <li key={s.product_id}>
                <a href={`/product/${s.product_id}`} className="block truncate px-3 py-2 text-sm hover:bg-slate-50">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      <select className="input w-auto" value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Search mode">
        {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
      </select>
      <button className="btn-primary" type="submit">Search</button>
    </form>
  );
}
