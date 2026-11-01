'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ProductCard } from '@/lib/data/types';
import { inr } from '@/lib/format';

type Item = ProductCard & { quantity: number };
type Address = { address_id: number; label: string; line1: string; city: string; state: string; pincode: string; is_default: boolean };

export function CartView({ items, addresses }: { items: Item[]; addresses: Address[] }) {
  const router = useRouter();
  const [addressId, setAddressId] = useState(addresses[0]?.address_id);
  const [method, setMethod] = useState('upi');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const fee = subtotal >= 499 || subtotal === 0 ? 0 : 40;

  async function call(method: string, url: string, body?: unknown) {
    setError(null);
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json();
    if (!res.ok) setError(data.error);
    return res.ok ? data : null;
  }

  async function checkout() {
    setBusy(true);
    const data = await call('POST', '/api/checkout', { addressId, method });
    setBusy(false);
    if (data) router.push(`/orders?placed=${data.orderId}`);
  }

  if (!items.length) {
    return <div className="card p-10 text-center text-slate-500">Your cart is empty. <a href="/" className="text-brand-700 underline">Start shopping</a></div>;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="card divide-y divide-slate-100">
        {items.map((i) => (
          <div key={i.product_id} className="flex gap-4 p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {i.image_url && <img src={i.image_url} alt="" className="h-20 w-20 object-contain" />}
            <div className="flex-1">
              <a href={`/product/${i.product_id}`} className="line-clamp-2 font-medium hover:text-brand-700">{i.title}</a>
              <div className="text-xs text-slate-400">{i.store_name} · {i.stock_qty} in stock</div>
              <div className="mt-2 flex items-center gap-3">
                <select className="input w-20" value={i.quantity}
                  onChange={async (e) => { if (await call('PATCH', '/api/cart', { productId: i.product_id, quantity: Number(e.target.value) })) router.refresh(); }}>
                  {Array.from({ length: 10 }, (_, k) => k + 1).map((n) => <option key={n}>{n}</option>)}
                </select>
                <button className="text-sm text-rose-600 hover:underline"
                  onClick={async () => { if (await call('DELETE', `/api/cart?productId=${i.product_id}`)) router.refresh(); }}>
                  Remove
                </button>
              </div>
            </div>
            <div className="text-right font-semibold">{inr(i.price * i.quantity)}</div>
          </div>
        ))}
      </div>

      <div className="card h-fit space-y-4 p-4">
        <h2 className="font-semibold">Checkout</h2>
        <div>
          <label className="label">Deliver to</label>
          <select className="input" value={addressId} onChange={(e) => setAddressId(Number(e.target.value))}>
            {addresses.map((a) => (
              <option key={a.address_id} value={a.address_id}>{a.label}: {a.line1}, {a.city} {a.pincode}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Payment (simulated)</label>
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="upi">UPI</option><option value="card">Card</option>
            <option value="netbanking">Net banking</option><option value="cod">Cash on delivery</option>
          </select>
        </div>
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{inr(subtotal)}</dd></div>
          <div className="flex justify-between"><dt>Shipping</dt><dd>{fee ? inr(fee) : 'Free'}</dd></div>
          <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold"><dt>Total</dt><dd>{inr(subtotal + fee)}</dd></div>
        </dl>
        <button className="btn-primary w-full" disabled={busy || !addressId} onClick={checkout}>
          {busy ? 'Placing order…' : 'Place order'}
        </button>
        {error && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}
        <p className="text-xs text-slate-400">
          Runs the <code>checkout()</code> stored function: one transaction that locks stock rows, creates the order,
          decrements inventory and clears the cart, or rolls everything back.
        </p>
      </div>
    </div>
  );
}
