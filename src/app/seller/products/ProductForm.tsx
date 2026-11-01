'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface ProductFormValues {
  product_id?: number;
  title: string; brand: string | null; description: string; features: string;
  price: number; mrp: number; stock_qty: number; reorder_threshold: number;
  image_url: string | null; is_active: boolean; category_id: number;
}

export function ProductForm({ initial, categories }: {
  initial?: ProductFormValues;
  categories: { category_id: number; path: string; depth: number }[];
}) {
  const router = useRouter();
  const [v, setV] = useState<ProductFormValues>(initial ?? {
    title: '', brand: '', description: '', features: '', price: 0, mrp: 0, stock_qty: 0, reorder_threshold: 10,
    image_url: '', is_active: true, category_id: categories.find((c) => c.depth > 0)?.category_id ?? categories[0]?.category_id,
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof ProductFormValues>(k: K, val: ProductFormValues[K]) => setV({ ...v, [k]: val });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const body = {
      title: v.title, brand: v.brand || null, description: v.description, features: v.features,
      price: Number(v.price), mrp: Number(v.mrp), stockQty: Number(v.stock_qty), reorderThreshold: Number(v.reorder_threshold),
      imageUrl: v.image_url || null, categoryId: Number(v.category_id), isActive: v.is_active,
    };
    const res = await fetch(initial?.product_id ? `/api/seller/products/${initial.product_id}` : '/api/seller/products', {
      method: initial?.product_id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return setMsg({ ok: false, text: data.error });
    setMsg({ ok: true, text: 'Saved. If the text changed, a trigger queued it for re-embedding.' });
    if (!initial?.product_id) router.push(`/seller/products/${data.product_id}`);
    else router.refresh();
  }

  return (
    <form onSubmit={save} className="card grid gap-4 p-6 sm:grid-cols-2">
      <div className="sm:col-span-2"><label className="label">Title</label>
        <input className="input" value={v.title} onChange={(e) => set('title', e.target.value)} required /></div>
      <div><label className="label">Brand</label>
        <input className="input" value={v.brand ?? ''} onChange={(e) => set('brand', e.target.value)} /></div>
      <div><label className="label">Category</label>
        <select className="input" value={v.category_id} onChange={(e) => set('category_id', Number(e.target.value))}>
          {categories.map((c) => <option key={c.category_id} value={c.category_id}>{c.path}</option>)}
        </select></div>
      <div><label className="label">Price (₹)</label>
        <input className="input" type="number" step="0.01" value={v.price} onChange={(e) => set('price', Number(e.target.value))} /></div>
      <div><label className="label">MRP (₹)</label>
        <input className="input" type="number" step="0.01" value={v.mrp} onChange={(e) => set('mrp', Number(e.target.value))} /></div>
      <div><label className="label">Stock</label>
        <input className="input" type="number" value={v.stock_qty} onChange={(e) => set('stock_qty', Number(e.target.value))} /></div>
      <div><label className="label">Low-stock threshold</label>
        <input className="input" type="number" value={v.reorder_threshold} onChange={(e) => set('reorder_threshold', Number(e.target.value))} /></div>
      <div className="sm:col-span-2"><label className="label">Image URL</label>
        <input className="input" value={v.image_url ?? ''} onChange={(e) => set('image_url', e.target.value)} placeholder="https://…" /></div>
      <div className="sm:col-span-2"><label className="label">Feature bullets (one per line)</label>
        <textarea className="input min-h-24" value={v.features} onChange={(e) => set('features', e.target.value)} /></div>
      <div className="sm:col-span-2"><label className="label">Description</label>
        <textarea className="input min-h-32" value={v.description} onChange={(e) => set('description', e.target.value)} /></div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={v.is_active} onChange={(e) => set('is_active', e.target.checked)} /> Listed (active)
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button className="btn-primary">Save product</button>
        {msg && <span className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{msg.text}</span>}
      </div>
    </form>
  );
}
