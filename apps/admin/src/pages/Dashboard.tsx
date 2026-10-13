import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { formatRupees } from '@testwise/shared';
import { Badge, Card, fmtDate, PageHeader, statusTone } from '../components/ui';
import { api } from '../lib/api';

interface Dashboard {
  finance: { netRevenuePaise: number; pendingRefunds: number; ordersLast24h: number };
  support: { openTickets: number };
  liveAttempts: number;
  users: { total: number; newLast7Days: number; onboarded: number };
  questions: Record<string, number>;
  tournaments: Record<string, number>;
  confirmedRegistrations: number;
  activeBanners: number;
  upcoming: { id: string; titleEn: string; status: string; startsAt: string; maxParticipants: number; _count: { registrations: number } }[];
}

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <Card>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-2 text-3xl font-extrabold tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </Card>
  );
}

export function DashboardPage() {
  const { data } = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/v1/admin/dashboard') });
  const q = data?.questions ?? {};
  const t = data?.tournaments ?? {};
  const totalQ = Object.values(q).reduce((a, b) => a + b, 0);
  return (
    <>
      <PageHeader title="Dashboard" subtitle="Live platform overview." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Students" value={data?.users.total ?? '—'} sub={`${data?.users.newLast7Days ?? 0} new in 7 days · ${data?.users.onboarded ?? 0} onboarded`} />
        <Stat label="Questions" value={totalQ} sub={`${q.APPROVED ?? 0} approved · ${q.IN_REVIEW ?? 0} awaiting review`} />
        <Stat label="Open tournaments" value={(t.REG_OPEN ?? 0) + (t.SCHEDULED ?? 0) + (t.LIVE ?? 0)} sub={`${t.DRAFT ?? 0} drafts`} />
        <Stat label="Registrations" value={data?.confirmedRegistrations ?? '—'} sub="confirmed" />
        <Stat label="Net revenue" value={data ? formatRupees(data.finance.netRevenuePaise) : '—'} sub={`${data?.finance.ordersLast24h ?? 0} paid orders in 24 h`} />
        <Stat label="Pending refunds" value={data?.finance.pendingRefunds ?? '—'} sub="awaiting approval" />
        <Stat label="Open tickets" value={data?.support.openTickets ?? '—'} sub="support queue" />
        <Stat label="Writing now" value={data?.liveAttempts ?? '—'} sub="tests in progress" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Upcoming tournaments" actions={<Link to="/tournaments" className="text-sm font-semibold text-brand-600">All</Link>}>
          {data?.upcoming.length ? (
            <ul className="divide-y divide-gray-50">
              {data.upcoming.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <Link to={`/tournaments/${u.id}`} className="block truncate font-semibold hover:text-brand-600">{u.titleEn}</Link>
                    <p className="text-xs text-gray-500">{fmtDate(u.startsAt)} · {u._count.registrations}/{u.maxParticipants} registered</p>
                  </div>
                  <Badge tone={statusTone(u.status)}>{u.status.replace('_', ' ')}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">Nothing scheduled.</p>
          )}
        </Card>
        <Card title="Content pipeline" actions={<Link to="/questions?status=IN_REVIEW" className="text-sm font-semibold text-brand-600">Review queue</Link>}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {['DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'RETIRED'].map((s) => (
              <Link key={s} to={`/questions?status=${s}`} className="rounded-xl bg-gray-50 p-3 text-center hover:bg-gray-100">
                <p className="text-xl font-extrabold tabular-nums">{q[s] ?? 0}</p>
                <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{s.replace('_', ' ')}</p>
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
