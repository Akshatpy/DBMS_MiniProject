import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getCart } from '@/lib/data/shop';
import { CartView } from './CartView';

export const dynamic = 'force-dynamic';

export default async function CartPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/cart');
  const { items, addresses } = await getCart(session);
  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">Your cart</h1>
      <CartView items={items} addresses={addresses} />
    </div>
  );
}
