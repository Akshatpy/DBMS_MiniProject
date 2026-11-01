'use client';

import { useState } from 'react';

const DEMO = [
  { role: 'Customer', email: 'customer@shopsense.dev', password: 'Customer@123' },
  { role: 'Seller', email: 'seller@shopsense.dev', password: 'Seller@123' },
  { role: 'Admin', email: 'admin@shopsense.dev', password: 'Admin@123' },
];
const HOME: Record<string, string> = { customer: '/', seller: '/seller', admin: '/admin' };

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function login(e?: React.FormEvent, creds?: { email: string; password: string }) {
    e?.preventDefault();
    setError(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creds ?? { email, password }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error);
    const next = new URLSearchParams(window.location.search).get('next');
    window.location.href = next ?? HOME[data.role];
  }

  return (
    <div className="mx-auto mt-8 max-w-sm space-y-6">
      <form onSubmit={login} className="card space-y-4 p-6">
        <h1 className="text-xl font-semibold">Sign in</h1>
        <div><label className="label">Email</label><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div><label className="label">Password</label><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button className="btn-primary w-full">Sign in</button>
        <p className="text-center text-sm text-slate-500">New here? <a className="text-brand-700 underline" href="/register">Create an account</a></p>
      </form>
      <div className="card p-4">
        <div className="label">Demo accounts</div>
        <div className="grid grid-cols-3 gap-2">
          {DEMO.map((d) => (
            <button key={d.role} className="btn-secondary" onClick={() => login(undefined, d)}>{d.role}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
