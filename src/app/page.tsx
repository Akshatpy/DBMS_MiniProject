import Link from 'next/link';
import { Suspense } from 'react';
import { getSession } from '@/lib/auth';
import { getHomeData } from '@/lib/data/catalog';
import { ProductRow } from '@/components/ProductCard';
import { SearchBar } from '@/components/SearchBar';

export const dynamic = 'force-dynamic';

const EXAMPLES = [
  'gift for a dad who loves gardening',
  'something to keep my dog\'s teeth clean',
  'comfortable shoes for standing all day',
  'keep coffee hot for hours',
  'toy that teaches kids to code',
  'Nintendo Switch controller',
];

export default async function Home() {
  const session = await getSession();
  const { categories, trending, deals, recommendations } = await getHomeData(session);

  return (
    <div>
      <section className="mb-10 rounded-2xl bg-gradient-to-br from-brand-700 to-indigo-500 px-6 py-10 text-white sm:px-10">
        <h1 className="max-w-2xl text-3xl font-bold leading-tight sm:text-4xl">Describe what you need. We&apos;ll find it.</h1>
        <p className="mt-2 max-w-2xl text-indigo-100">
          Hybrid search fuses PostgreSQL full-text ranking with vector similarity over product descriptions
          and real customer reviews, so plain-language searches work.
        </p>
        <div className="mt-6 max-w-3xl rounded-xl bg-white/10 p-2 backdrop-blur">
          <Suspense><SearchBar large /></Suspense>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {EXAMPLES.map((e) => (
            <Link key={e} href={`/search?q=${encodeURIComponent(e)}&mode=hybrid`}
              className="rounded-full bg-white/15 px-3 py-1 text-sm hover:bg-white/25">
              {e}
            </Link>
          ))}
        </div>
      </section>

      {recommendations.length > 0 && (
        <ProductRow
          title="Recommended for you"
          subtitle="Nearest neighbours of your taste vector: the average embedding of everything you have bought"
          products={recommendations}
          render={(p) => <span className="text-slate-500">match {(100 * (p as typeof recommendations[number]).similarity).toFixed(0)}%</span>}
        />
      )}

      <section className="mb-10">
        <h2 className="section-title">Shop by category</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {categories.map((c) => (
            <Link key={c.category_id} href={`/search?q=${encodeURIComponent(c.name)}&mode=hybrid&category=${c.category_id}`}
              className="card px-4 py-3 hover:border-brand-500">
              <div className="font-medium text-slate-800">{c.name}</div>
              <div className="text-xs text-slate-400">{c.product_count} products</div>
            </Link>
          ))}
        </div>
      </section>

      <ProductRow title="Trending this month" subtitle="Most units sold in the last 30 days" products={trending}
        render={(p) => <span className="text-slate-500">{(p as typeof trending[number]).units} sold recently</span>} />
      <ProductRow title="Top-rated deals" subtitle="Rated 4★ and above, sorted by discount" products={deals} />
    </div>
  );
}
