import { notFound } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getProduct } from '@/lib/data/catalog';
import { inr, date } from '@/lib/format';
import { ProductCard, Stars, StockBadge } from '@/components/ProductCard';
import { AddToCart, ReviewForm } from '@/components/ProductActions';

export const dynamic = 'force-dynamic';

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const session = await getSession();
  const data = await getProduct(session, id);
  if (!data) notFound();
  const { product: p, reviews, ratingDist, similar, fbt } = data;
  const features = p.features.split('\n').filter(Boolean);
  const maxDist = Math.max(1, ...ratingDist.map((r) => r.n));

  return (
    <div className="space-y-10">
      <div className="text-xs text-slate-400">{p.category_path}</div>
      <div className="grid gap-8 md:grid-cols-[minmax(0,420px)_1fr]">
        <div className="card flex h-96 items-center justify-center p-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {p.image_url ? <img src={p.image_url} alt={p.title} className="max-h-full max-w-full object-contain" /> : <span className="text-6xl">🛍️</span>}
        </div>
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold leading-snug">{p.title}</h1>
          <div className="text-sm text-slate-500">
            {p.brand && <>by <span className="font-medium text-slate-700">{p.brand}</span> · </>}
            sold by <span className="font-medium text-slate-700">{p.store_name}</span>
          </div>
          <div className="flex items-center gap-2">
            <Stars value={p.avg_rating} size="lg" />
            <span className="text-sm text-slate-500">{p.avg_rating.toFixed(1)} · {p.review_count} reviews</span>
          </div>
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold">{inr(p.price)}</span>
            {p.mrp > p.price && <span className="text-slate-400 line-through">{inr(p.mrp)}</span>}
            {p.discount_pct > 0 && <span className="font-medium text-emerald-600">{p.discount_pct}% off</span>}
          </div>
          <StockBadge status={p.stock_status} qty={p.stock_qty} />
          <div className="max-w-sm">
            <AddToCart productId={p.product_id} disabled={p.stock_qty === 0} signedInAs={session?.role ?? null} />
          </div>
          {features.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
              {features.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          )}
          {p.description && <p className="text-sm leading-relaxed text-slate-600">{p.description}</p>}
        </div>
      </div>

      {fbt.length > 0 && (
        <section>
          <h2 className="section-title mb-0">Frequently bought together</h2>
          <p className="mb-3 text-sm text-slate-500">
            Association rules mined from order history (materialized view <code>mv_product_pairs</code>).
            Confidence = P(this item | viewed item); lift &gt; 1 means bought together more often than chance.
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {fbt.map((f) => (
              <ProductCard key={f.product_id} p={f}>
                <div className="flex justify-between text-slate-600">
                  <span>conf {(100 * f.confidence).toFixed(0)}%</span>
                  <span>lift {f.lift.toFixed(1)}×</span>
                  <span>{f.together_count} orders</span>
                </div>
              </ProductCard>
            ))}
          </div>
        </section>
      )}

      {similar.length > 0 && (
        <section>
          <h2 className="section-title mb-0">Similar products</h2>
          <p className="mb-3 text-sm text-slate-500">Nearest neighbours in embedding space (cosine similarity, HNSW index)</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {similar.slice(0, 8).map((s) => (
              <ProductCard key={s.product_id} p={s}>
                <span className="text-slate-500">similarity {s.similarity.toFixed(2)}</span>
              </ProductCard>
            ))}
          </div>
        </section>
      )}

      <section className="grid gap-8 md:grid-cols-[280px_1fr]">
        <div className="space-y-4">
          <div className="card space-y-1 p-4">
            <h2 className="mb-2 font-semibold">Ratings</h2>
            {ratingDist.map((r) => (
              <div key={r.stars} className="flex items-center gap-2 text-sm">
                <span className="w-6">{r.stars}★</span>
                <div className="h-2 flex-1 rounded bg-slate-100">
                  <div className="h-2 rounded bg-amber-400" style={{ width: `${(100 * r.n) / maxDist}%` }} />
                </div>
                <span className="w-6 text-right text-slate-500">{r.n}</span>
              </div>
            ))}
          </div>
          {session?.role === 'customer' && <ReviewForm productId={p.product_id} />}
        </div>
        <div className="space-y-3">
          <h2 className="section-title">Customer reviews</h2>
          {reviews.length === 0 && <p className="text-sm text-slate-500">No reviews yet.</p>}
          {reviews.map((r) => (
            <article key={r.review_id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Stars value={r.rating} />
                {r.title && <span className="font-medium">{r.title}</span>}
                {r.verified_purchase && <span className="badge bg-emerald-100 text-emerald-700">Verified purchase</span>}
              </div>
              <p className="mt-2 text-sm leading-relaxed text-slate-700">{r.body}</p>
              <div className="mt-2 text-xs text-slate-400">
                {r.reviewer_name} · {date(r.created_at)}{r.helpful_votes > 0 && ` · ${r.helpful_votes} found helpful`}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
