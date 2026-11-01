'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function AddToCart({ productId, disabled, signedInAs }: { productId: number; disabled: boolean; signedInAs: string | null }) {
  const router = useRouter();
  const [qty, setQty] = useState(1);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (signedInAs !== 'customer') {
    return <a href="/login" className="btn-primary">{signedInAs ? 'Sign in as a customer to buy' : 'Sign in to buy'}</a>;
  }

  async function add() {
    setBusy(true);
    const res = await fetch('/api/cart', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, quantity: qty }),
    });
    const body = await res.json();
    setBusy(false);
    // errors such as "Only 3 unit(s) in stock" come straight from the cart trigger
    setMsg(res.ok ? { ok: true, text: 'Added to cart' } : { ok: false, text: body.error });
    if (res.ok) router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <select className="input w-20" value={qty} onChange={(e) => setQty(Number(e.target.value))} aria-label="Quantity">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}
        </select>
        <button className="btn-primary flex-1" disabled={disabled || busy} onClick={add}>
          {disabled ? 'Out of stock' : busy ? 'Adding…' : 'Add to cart'}
        </button>
      </div>
      {msg && (
        <p className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-rose-600'}`}>
          {msg.text} {msg.ok && <a href="/cart" className="underline">View cart</a>}
        </p>
      )}
    </div>
  );
}

export function ReviewForm({ productId }: { productId: number }) {
  const router = useRouter();
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/reviews', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, rating, title, body }),
    });
    const data = await res.json();
    if (res.ok) {
      setMsg({ ok: true, text: data.verified_purchase
        ? 'Thanks! Marked as a verified purchase. It becomes searchable once the embedding worker processes it.'
        : 'Thanks! (Not a verified purchase: no paid order for this product was found.)' });
      setBody(''); setTitle('');
      router.refresh();
    } else setMsg({ ok: false, text: data.error });
  }

  return (
    <form onSubmit={submit} className="card space-y-3 p-4">
      <h3 className="font-semibold">Write a review</h3>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button type="button" key={n} onClick={() => setRating(n)}
            className={`text-2xl ${n <= rating ? 'text-amber-500' : 'text-slate-300'}`} aria-label={`${n} stars`}>★</button>
        ))}
      </div>
      <input className="input" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="input min-h-24" placeholder="What did you like or dislike? (min 10 characters)"
        value={body} onChange={(e) => setBody(e.target.value)} />
      <button className="btn-primary">Submit review</button>
      {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{msg.text}</p>}
    </form>
  );
}
