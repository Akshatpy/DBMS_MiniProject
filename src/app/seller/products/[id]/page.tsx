import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getCategoryOptions } from '@/lib/data/catalog';
import { getSellerProduct } from '@/lib/data/seller';
import { ProductForm } from '../ProductForm';

export const dynamic = 'force-dynamic';

export default async function EditProduct({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== 'seller') redirect('/login');
  const id = Number((await params).id);
  const [product, categories] = await Promise.all([getSellerProduct(session, id), getCategoryOptions()]);
  if (!product) notFound();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Edit product #{id}</h1>
        <a href={`/product/${id}`} className="ml-auto text-sm text-brand-700 underline">View listing</a>
      </div>
      <ProductForm initial={product} categories={categories} />
    </div>
  );
}
