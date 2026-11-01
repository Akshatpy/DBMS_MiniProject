'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function CancelButton({ orderId }: { orderId: number }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      <button className="btn-secondary py-1 text-rose-600"
        onClick={async () => {
          if (!confirm(`Cancel order #${orderId}? Stock will be returned to inventory.`)) return;
          const res = await fetch(`/api/orders/${orderId}/cancel`, { method: 'POST' });
          if (res.ok) router.refresh();
          else setErr((await res.json()).error);
        }}>
        Cancel
      </button>
      {err && <span className="text-xs text-rose-600">{err}</span>}
    </span>
  );
}
