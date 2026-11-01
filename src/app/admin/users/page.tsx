import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getUsers } from '@/lib/data/admin';
import { date, dateTime } from '@/lib/format';
import { ToggleActive } from './ToggleActive';

export const dynamic = 'force-dynamic';

export default async function AdminUsers({ searchParams }: { searchParams: Promise<{ q?: string; role?: string }> }) {
  const session = await getSession();
  if (!session || session.role !== 'admin') redirect('/login');
  const { q = '', role = '' } = await searchParams;
  const users = await getUsers(session, q, role);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Users</h1>
        <form className="ml-auto flex gap-2">
          <input name="q" defaultValue={q} className="input w-56" placeholder="Name or email" />
          <select name="role" defaultValue={role} className="input w-36">
            <option value="">All roles</option><option value="customer">Customers</option>
            <option value="seller">Sellers</option><option value="admin">Admins</option>
          </select>
          <button className="btn-secondary">Search</button>
        </form>
      </div>
      <p className="text-xs text-slate-400">
        The app role may update only <code>users.is_active</code> (column-level GRANT), only as an admin (RLS policy), and can never read password hashes.
      </p>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Role</th><th className="text-right">Orders</th><th>Joined</th><th>Last login</th><th>Status</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.user_id}>
                <td>{u.user_id}</td>
                <td>{u.full_name}{u.store_name && <div className="text-xs text-slate-400">{u.store_name}</div>}</td>
                <td>{u.email}</td>
                <td className="capitalize">{u.role}</td>
                <td className="text-right">{u.order_count}</td>
                <td className="whitespace-nowrap">{date(u.created_at)}</td>
                <td className="whitespace-nowrap">{u.last_login_at ? dateTime(u.last_login_at) : '—'}</td>
                <td>{u.user_id === session.uid ? <span className="text-xs text-slate-400">you</span> : <ToggleActive id={u.user_id} active={u.is_active} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
