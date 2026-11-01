import { getCategoryOptions } from '@/lib/data/catalog';
import { ProductForm } from '../ProductForm';

export const dynamic = 'force-dynamic';

export default async function NewProduct() {
  const categories = await getCategoryOptions();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">New product</h1>
      <ProductForm categories={categories} />
    </div>
  );
}
