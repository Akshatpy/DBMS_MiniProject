import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ProductCard as P } from '@/lib/data/types';
import { inr } from '@/lib/format';

export function Stars({ value, size = 'sm' }: { value: number; size?: 'sm' | 'lg' }) {
  const full = Math.round(value);
  return (
    <span className={size === 'lg' ? 'text-lg' : 'text-xs'} aria-label={`${value} out of 5`}>
      <span className="text-amber-500">{'★'.repeat(full)}</span>
      <span className="text-slate-300">{'★'.repeat(5 - full)}</span>
    </span>
  );
}

export function StockBadge({ status, qty }: { status: P['stock_status']; qty: number }) {
  if (status === 'out_of_stock') return <span className="badge bg-rose-100 text-rose-700">Out of stock</span>;
  if (status === 'low_stock') return <span className="badge bg-amber-100 text-amber-800">Only {qty} left</span>;
  return null;
}

export function ProductCard({ p, children }: { p: P; children?: ReactNode }) {
  return (
    <div className="card flex flex-col overflow-hidden transition hover:shadow-md">
      <Link href={`/product/${p.product_id}`} className="flex flex-1 flex-col">
        <div className="flex h-44 items-center justify-center bg-white p-3">
          {p.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.image_url} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
          ) : (
            <div className="text-4xl text-slate-300">🛍️</div>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1 border-t border-slate-100 p-3">
          <div className="text-[11px] uppercase tracking-wide text-slate-400">{p.category_name}</div>
          <div className="line-clamp-2 text-sm font-medium leading-snug text-slate-800">{p.title}</div>
          <div className="flex items-center gap-1">
            <Stars value={p.avg_rating} />
            <span className="text-xs text-slate-400">({p.review_count})</span>
          </div>
          <div className="mt-auto flex items-baseline gap-2 pt-1">
            <span className="font-semibold">{inr(p.price)}</span>
            {p.mrp > p.price && <span className="text-xs text-slate-400 line-through">{inr(p.mrp)}</span>}
            {p.discount_pct > 0 && <span className="text-xs font-medium text-emerald-600">{p.discount_pct}% off</span>}
          </div>
          <StockBadge status={p.stock_status} qty={p.stock_qty} />
        </div>
      </Link>
      {children && <div className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-xs">{children}</div>}
    </div>
  );
}

export function ProductRow({ title, subtitle, products, render }: {
  title: string;
  subtitle?: string;
  products: P[];
  render?: (p: P) => ReactNode;
}) {
  if (!products.length) return null;
  return (
    <section className="mb-10">
      <h2 className="section-title mb-0">{title}</h2>
      {subtitle && <p className="mb-3 text-sm text-slate-500">{subtitle}</p>}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {products.map((p) => (
          <ProductCard key={p.product_id} p={p}>{render?.(p)}</ProductCard>
        ))}
      </div>
    </section>
  );
}
