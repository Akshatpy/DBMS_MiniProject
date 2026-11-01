'use client';

export function LogoutButton() {
  return (
    <button
      className="text-sm text-slate-600 hover:text-slate-900"
      onClick={async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/';
      }}
    >
      Sign out
    </button>
  );
}
