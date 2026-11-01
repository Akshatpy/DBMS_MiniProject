'use client';

import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

const fmtInr = (v: number) => '₹' + Number(v).toLocaleString('en-IN', { notation: 'compact', maximumFractionDigits: 1 });
const fmtMonth = (d: string) => new Date(d).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
const fmtDay = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export function RevenueTrendChart({ data, barKey = 'revenue', lineKey, lineLabel, x = 'month', height = 280 }: {
  data: Record<string, unknown>[];
  barKey?: string;
  lineKey: string;
  lineLabel: string;
  x?: 'month' | 'day';
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey={x} tickFormatter={x === 'month' ? fmtMonth : fmtDay} tick={{ fontSize: 11 }} minTickGap={12} />
        <YAxis tickFormatter={fmtInr} tick={{ fontSize: 11 }} width={60} />
        <Tooltip
          formatter={(v: number, name: string) => [fmtInr(v), name]}
          labelFormatter={(l: string) => (x === 'month' ? fmtMonth(l) : fmtDay(l))}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey={barKey} name="Revenue" fill="#818cf8" radius={[3, 3, 0, 0]} />
        <Line dataKey={lineKey} name={lineLabel} stroke="#f59e0b" strokeWidth={2} dot={false} type="monotone" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
