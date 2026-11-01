import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getSellerProducts } from '@/lib/data/seller';
import { inr, dateTime } from '@/lib/format';
import { RestockButton } from '../SellerActions';

export const dynamic = 'force-dynamic';

export default async function SellerProducts({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getSession();
  if (!session || session.role !== 'seller') redirect('/login');
  const { q = '' } = await searchParams;
  const products = await getSellerProducts(session, q);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Your products</h1>
        <form className="ml-auto flex gap-2">
          <input name="q" defaultValue={q} className="input w-64" placeholder="Filter by title" />
          <button className="btn-secondary">Filter</button>
        </form>
        <Link href="/seller/products/new" className="btn-primary">+ New product</Link>
      </div>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr><th>Product</th><th className="text-right">Price</th><th className="text-right">Stock</th><th>Rating</th><th>Embedding</th><th>Restock</th></tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.product_id} className={p.is_active ? '' : 'opacity-50'}>
                <td className="max-w-md">
                  <Link href={`/seller/products/${p.product_id}`} className="line-clamp-1 font-medium hover:text-brand-700">{p.title}</Link>
                  <div className="text-xs text-slate-400">{p.category}{!p.is_active && ' · unlisted'}</div>
                </td>
                <td className="text-right">{inr(p.price)}</td>
                <td className={`text-right font-medium ${p.stock_qty < p.reorder_threshold ? 'text-amber-600' : ''}`}>
                  {p.stock_qty}<span className="text-xs text-slate-400"> / {p.reorder_threshold}</span>
                </td>
                <td className="whitespace-nowrap">{p.avg_rating} ★ ({p.review_count})</td>
                <td className="whitespace-nowrap text-xs">
                  {p.embedding_pending
                    ? <span className="badge bg-amber-100 text-amber-800">queued</span>
                    : p.embedded_at ? <span className="text-slate-500">{dateTime(p.embedded_at)}</span> : '—'}
                </td>
                <td><RestockButton productId={p.product_id} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
