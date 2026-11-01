export const inr = (n: number | string | null | undefined) =>
  n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

export const compact = (n: number | string) =>
  Number(n).toLocaleString('en-IN', { notation: 'compact', maximumFractionDigits: 1 });

export const date = (d: string | Date) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export const dateTime = (d: string | Date) =>
  new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const monthLabel = (d: string | Date) =>
  new Date(d).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
