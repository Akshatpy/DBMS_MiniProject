'use client';

import { useState } from 'react';

export default function RegisterPage() {
  const [role, setRole] = useState<'customer' | 'seller'>('customer');
  const [f, setF] = useState({
    fullName: '', email: '', password: '', phone: '',
    line1: '', city: '', state: '', pincode: '', storeName: '', gstin: '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const body = role === 'customer'
      ? { role, email: f.email, password: f.password, fullName: f.fullName, phone: f.phone,
          address: { line1: f.line1, city: f.city, state: f.state, pincode: f.pincode } }
      : { role, email: f.email, password: f.password, fullName: f.fullName, phone: f.phone, storeName: f.storeName, gstin: f.gstin };
    const res = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) return setError(data.error);
    window.location.href = role === 'seller' ? '/seller' : '/';
  }

  return (
    <form onSubmit={submit} className="card mx-auto mt-6 max-w-lg space-y-4 p-6">
      <h1 className="text-xl font-semibold">Create an account</h1>
      <div className="grid grid-cols-2 gap-2">
        {(['customer', 'seller'] as const).map((r) => (
          <button type="button" key={r} onClick={() => setRole(r)}
            className={role === r ? 'btn-primary' : 'btn-secondary'}>
            {r === 'customer' ? 'I want to shop' : 'I want to sell'}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label">Full name</label><input className="input" value={f.fullName} onChange={set('fullName')} required /></div>
        <div><label className="label">Mobile (10 digits)</label><input className="input" value={f.phone} onChange={set('phone')} placeholder="9876543210" /></div>
        <div><label className="label">Email</label><input className="input" type="email" value={f.email} onChange={set('email')} required /></div>
        <div><label className="label">Password</label><input className="input" type="password" value={f.password} onChange={set('password')} required /></div>
      </div>
      {role === 'customer' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><label className="label">Address</label><input className="input" value={f.line1} onChange={set('line1')} required /></div>
          <div><label className="label">City</label><input className="input" value={f.city} onChange={set('city')} required /></div>
          <div><label className="label">State</label><input className="input" value={f.state} onChange={set('state')} required /></div>
          <div><label className="label">PIN code</label><input className="input" value={f.pincode} onChange={set('pincode')} placeholder="560001" required /></div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label">Store name</label><input className="input" value={f.storeName} onChange={set('storeName')} required /></div>
          <div><label className="label">GSTIN (optional)</label><input className="input" value={f.gstin} onChange={set('gstin')} placeholder="29ABCDE1234F1Z5" /></div>
        </div>
      )}
      {error && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}
      <button className="btn-primary w-full">Create account</button>
      <p className="text-xs text-slate-400">
        Validation (email, phone, PIN code and GSTIN formats, password strength, unique email) is enforced by
        PostgreSQL domains, constraints and the register_* functions. Error messages come straight from the database.
      </p>
    </form>
  );
}
