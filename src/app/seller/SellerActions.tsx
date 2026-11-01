'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function RestockButton({ productId }: { productId: number }) {
  const router = useRouter();
  const [qty, setQty] = useState(50);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-1">
      <input type="number" className="input w-20 py-1" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
      <button className="btn-secondary py-1"
        onClick={async () => {
          setErr(null);
          const res = await fetch(`/api/seller/products/${productId}/restock`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity: qty }),
          });
          if (res.ok) router.refresh(); else setErr((await res.json()).error);
        }}>
        Restock
      </button>
      {err && <span className="text-xs text-rose-600">{err}</span>}
    </span>
  );
}

export function FulfilButton({ orderId, status }: { orderId: number; status: string }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const next = status === 'pending' ? 'paid' : status === 'paid' ? 'shipped' : 'delivered';
  const label = { paid: 'Mark paid', shipped: 'Mark shipped', delivered: 'Mark delivered' }[next];
  return (
    <span className="flex items-center gap-1">
      <button className="btn-secondary py-1"
        onClick={async () => {
          const res = await fetch(`/api/seller/orders/${orderId}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }),
          });
          if (res.ok) router.refresh(); else setErr((await res.json()).error);
        }}>
        {label}
      </button>
      {err && <span className="text-xs text-rose-600">{err}</span>}
    </span>
  );
}
