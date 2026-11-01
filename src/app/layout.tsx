import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import './globals.css';
import { getSession } from '@/lib/auth';
import { SearchBar } from '@/components/SearchBar';
import { LogoutButton } from '@/components/LogoutButton';

export const metadata: Metadata = {
  title: 'ShopSense — hybrid semantic product discovery',
  description: 'PostgreSQL + pgvector marketplace with hybrid search, analytics and RLS',
};

const NAV: Record<string, { href: string; label: string }[]> = {
  customer: [{ href: '/orders', label: 'Orders' }, { href: '/cart', label: 'Cart' }],
  seller: [{ href: '/seller', label: 'Dashboard' }, { href: '/seller/products', label: 'Products' }],
  admin: [
    { href: '/admin', label: 'Analytics' },
    { href: '/admin/search-quality', label: 'Search quality' },
    { href: '/admin/lab', label: 'DB lab' },
    { href: '/admin/users', label: 'Users' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3">
            <Link href="/" className="text-xl font-bold tracking-tight text-brand-700">
              Shop<span className="text-slate-800">Sense</span>
            </Link>
            <div className="order-3 w-full md:order-2 md:w-auto md:flex-1">
              <Suspense><SearchBar /></Suspense>
            </div>
            <nav className="order-2 ml-auto flex items-center gap-4 md:order-3">
              {session ? (
                <>
                  {NAV[session.role].map((n) => (
                    <Link key={n.href} href={n.href} className="text-sm font-medium text-slate-700 hover:text-brand-700">
                      {n.label}
                    </Link>
                  ))}
                  <span className="hidden text-sm text-slate-400 lg:inline">
                    {session.name} · <span className="capitalize">{session.role}</span>
                  </span>
                  <LogoutButton />
                </>
              ) : (
                <>
                  <Link href="/login" className="text-sm font-medium text-slate-700 hover:text-brand-700">Sign in</Link>
                  <Link href="/register" className="btn-primary">Create account</Link>
                </>
              )}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        <footer className="mt-12 border-t border-slate-200 py-6 text-center text-xs text-slate-400">
          ShopSense · PostgreSQL 17 + pgvector · Next.js · Product data: Amazon Reviews 2023 (McAuley Lab, UCSD)
        </footer>
      </body>
    </html>
  );
}
