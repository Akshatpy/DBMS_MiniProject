import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { searchProducts } from '@/lib/data/search';
import { getCategoryOptions } from '@/lib/data/catalog';
import type { SearchHit, SearchMode } from '@/lib/data/types';
import { ProductCard } from '@/components/ProductCard';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | undefined>;
const MODES: SearchMode[] = ['lexical', 'semantic', 'hybrid'];
const MODE_LABEL: Record<SearchMode, string> = { lexical: 'Keyword (full-text)', semantic: 'Semantic (vectors)', hybrid: 'Hybrid (RRF)' };

function num(v?: string) {
  const n = Number(v);
  return v && Number.isFinite(n) ? n : null;
}

function Why({ h }: { h: SearchHit }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {h.lexical_rank && <span className="badge bg-sky-100 text-sky-800">keyword #{h.lexical_rank}</span>}
        {h.semantic_rank && <span className="badge bg-violet-100 text-violet-800">meaning #{h.semantic_rank}</span>}
        {h.review_rank && <span className="badge bg-emerald-100 text-emerald-800">review #{h.review_rank}</span>}
      </div>
      {h.matched_review_body && (
        <p className="line-clamp-3 italic text-slate-500" title={h.matched_review_body}>
          “{h.matched_review_body.slice(0, 180)}{h.matched_review_body.length > 180 ? '…' : ''}”
        </p>
      )}
    </div>
  );
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const mode = (MODES.includes(sp.mode as SearchMode) ? sp.mode : 'hybrid') as SearchMode;
  const compare = sp.compare === '1';
  const filters = {
    categoryId: num(sp.category), minPrice: num(sp.minPrice), maxPrice: num(sp.maxPrice),
    minRating: num(sp.minRating), inStock: sp.inStock === '1',
  };
  const [session, categories] = await Promise.all([getSession(), getCategoryOptions()]);

  if (!q) return <p className="text-slate-500">Type something to search.</p>;

  const runs = compare
    ? await Promise.all(MODES.map((m) => searchProducts(session, { q, mode: m, ...filters, limit: 10 })))
    : [await searchProducts(session, { q, mode, ...filters, limit: 24 })];

  const qs = (over: SP) => {
    const u = new URLSearchParams(Object.entries({ ...sp, ...over }).filter(([, v]) => v != null && v !== '') as [string, string][]);
    return `/search?${u}`;
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[230px_1fr]">
      {/* Filters: a plain GET form, applied as SQL predicates inside search_products() */}
      <aside>
        <form action="/search" className="card space-y-4 p-4">
          <input type="hidden" name="q" value={q} />
          <input type="hidden" name="mode" value={mode} />
          {compare && <input type="hidden" name="compare" value="1" />}
          <div>
            <label className="label">Category</label>
            <select name="category" defaultValue={sp.category ?? ''} className="input">
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.category_id} value={c.category_id}>
                  {c.depth ? ' ↳ ' : ''}{c.path.split(' > ').pop()} ({c.product_count})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">Min ₹</label><input name="minPrice" type="number" min="0" defaultValue={sp.minPrice} className="input" /></div>
            <div><label className="label">Max ₹</label><input name="maxPrice" type="number" min="0" defaultValue={sp.maxPrice} className="input" /></div>
          </div>
          <div>
            <label className="label">Min rating</label>
            <select name="minRating" defaultValue={sp.minRating ?? ''} className="input">
              <option value="">Any</option>
              {[4, 3, 2].map((r) => <option key={r} value={r}>{r}★ & up</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="inStock" value="1" defaultChecked={filters.inStock} /> In stock only
          </label>
          <button className="btn-primary w-full">Apply filters</button>
        </form>
      </aside>

      <div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold">
            Results for “{q}”
          </h1>
          <div className="ml-auto flex overflow-hidden rounded-lg border border-slate-300 bg-white text-sm">
            {MODES.map((m) => (
              <Link key={m} href={qs({ mode: m, compare: undefined })}
                className={`px-3 py-1.5 ${!compare && m === mode ? 'bg-brand-600 text-white' : 'hover:bg-slate-50'}`}>
                {MODE_LABEL[m].split(' ')[0]}
              </Link>
            ))}
            <Link href={qs({ compare: '1' })}
              className={`border-l border-slate-300 px-3 py-1.5 ${compare ? 'bg-brand-600 text-white' : 'hover:bg-slate-50'}`}>
              Compare all 3
            </Link>
          </div>
        </div>

        {compare ? (
          <div className="grid gap-4 md:grid-cols-3">
            {runs.map((r, i) => (
              <div key={MODES[i]}>
                <div className="mb-2 flex items-baseline justify-between">
                  <h2 className="font-semibold">{MODE_LABEL[MODES[i]]}</h2>
                  <span className="text-xs text-slate-400">{r.hits.length} hits · {(r.timings.embedMs + r.timings.sqlMs).toFixed(0)} ms</span>
                </div>
                <ol className="space-y-2">
                  {r.hits.map((h, j) => (
                    <li key={h.product_id} className="card flex gap-3 p-2">
                      <span className="w-5 shrink-0 text-right text-xs text-slate-400">{j + 1}</span>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {h.image_url && <img src={h.image_url} alt="" className="h-12 w-12 shrink-0 object-contain" />}
                      <Link href={`/product/${h.product_id}`} className="line-clamp-2 text-sm hover:text-brand-700">{h.title}</Link>
                    </li>
                  ))}
                  {r.hits.length === 0 && <li className="text-sm text-slate-400">No results</li>}
                </ol>
              </div>
            ))}
          </div>
        ) : (
          <>
            <p className="mb-3 text-xs text-slate-400">
              {runs[0].hits.length} results · query embedding {runs[0].timings.embedMs.toFixed(0)} ms · SQL {runs[0].timings.sqlMs.toFixed(0)} ms
              · {MODE_LABEL[mode]}
            </p>
            {runs[0].hits.length === 0 ? (
              <div className="card p-8 text-center text-slate-500">
                No matches. {mode === 'lexical' && <Link className="text-brand-700 underline" href={qs({ mode: 'hybrid' })}>Try hybrid search</Link>}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
                {runs[0].hits.map((h) => (
                  <ProductCard key={h.product_id} p={h}>{mode !== 'lexical' || h.lexical_rank ? <Why h={h} /> : null}</ProductCard>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
