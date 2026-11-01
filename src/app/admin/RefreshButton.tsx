'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function RefreshButton() {
  const router = useRouter();
  const [state, setState] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      {state && <span className="text-xs text-slate-500">{state}</span>}
      <button className="btn-secondary"
        onClick={async () => {
          setState('Refreshing…');
          const res = await fetch('/api/admin/refresh', { method: 'POST' });
          const data = await res.json();
          setState(res.ok ? `Refreshed in ${data.ms} ms` : data.error);
          router.refresh();
        }}>
        CALL refresh_analytics()
      </button>
    </div>
  );
}
