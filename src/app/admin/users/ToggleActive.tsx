'use client';

import { useRouter } from 'next/navigation';

export function ToggleActive({ id, active }: { id: number; active: boolean }) {
  const router = useRouter();
  return (
    <button
      className={`badge cursor-pointer ${active ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}
      title={active ? 'Click to deactivate' : 'Click to reactivate'}
      onClick={async () => {
        const res = await fetch(`/api/admin/users/${id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !active }),
        });
        if (res.ok) router.refresh(); else alert((await res.json()).error);
      }}
    >
      {active ? 'Active' : 'Deactivated'}
    </button>
  );
}
