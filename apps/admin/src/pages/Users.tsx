import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { formatRupees } from '@testwise/shared';
import { Badge, Button, Empty, ErrorBox, Field, fmtDate, Input, Modal, PageHeader, Pager, statusTone, Table, Textarea } from '../components/ui';
import { api, can } from '../lib/api';

interface UserRow {
  id: string; email: string | null; displayName: string; audience: string | null; classLevel: number | null;
  language: string; status: string; authProvider: string; onboardedAt: string | null; createdAt: string; streakDays: number;
}

export function UsersPage() {
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ['users', q, page],
    queryFn: () => api<{ items: UserRow[]; total: number; page: number; pageSize: number }>(`/v1/admin/users?${new URLSearchParams({ q, page: String(page) })}`),
  });
  return (
    <>
      <PageHeader title="Students" subtitle="Search accounts, view history and suspend or reinstate with a recorded reason." />
      <Input placeholder="Search name, email or ID — press Enter" defaultValue={q} className="mb-4 max-w-md" onKeyDown={(e) => { if (e.key === 'Enter') { setQ(e.currentTarget.value); setPage(1); } }} />
      {!data?.items.length ? (
        <Empty>No students found.</Empty>
      ) : (
        <>
          <Table head={['Student', 'Profile', 'Language', 'Sign-in', 'Status', 'Joined']}>
            {data.items.map((u) => (
              <tr key={u.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setOpenId(u.id)}>
                <td className="px-4 py-3"><p className="font-semibold">{u.displayName}</p><p className="text-xs text-gray-400">{u.email}</p></td>
                <td className="px-4 py-3 text-xs">{u.audience === 'SCHOOL' ? `School · Class ${u.classLevel}` : u.audience === 'EXAM' ? 'Exam aspirant' : <span className="text-gray-400">Not onboarded</span>}</td>
                <td className="px-4 py-3 text-xs">{u.language}</td>
                <td className="px-4 py-3 text-xs">{u.authProvider}</td>
                <td className="px-4 py-3"><Badge tone={statusTone(u.status)}>{u.status}</Badge></td>
                <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(u.createdAt)}</td>
              </tr>
            ))}
          </Table>
          <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
      {openId && <UserDetail id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function UserDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const { data } = useQuery({
    queryKey: ['user', id],
    queryFn: () => api<UserRow & {
      dateOfBirth: string | null; guardianConsent: boolean; xp: number; exams: { exam: { nameEn: string } }[]; registrations: { id: string; status: string; tournament: { titleEn: string } }[];
      audit: { id: string; action: string; createdAt: string; meta: { reason?: string } | null }[];
      attempts: { id: string; status: string; score: number | null; maxScore: number | null; accuracy: number | null; submittedAt: string | null; test: { titleEn: string }; tournament: { titleEn: string } | null; _count: { events: number } }[];
      orders: { id: string; receiptNo: string; descriptionEn: string; amountPaise: number; status: string; createdAt: string }[];
      enrollments: { id: string; source: string; expiresAt: string; revokedAt: string | null; series: { titleEn: string } }[];
      tickets: { id: string; subject: string; category: string; status: string }[];
    }>(`/v1/admin/users/${id}`),
  });
  const setStatus = useMutation({
    mutationFn: (status: 'ACTIVE' | 'SUSPENDED') => api(`/v1/admin/users/${id}/status`, { method: 'PATCH', json: { status, reason } }),
    onSuccess: () => {
      setReason('');
      void qc.invalidateQueries({ queryKey: ['user', id] });
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
  return (
    <Modal open onClose={onClose} title={data?.displayName ?? 'Student'} wide>
      {data && (
        <div className="space-y-5 text-sm">
          <div className="grid gap-3 sm:grid-cols-3">
            <Info k="Email" v={data.email ?? '—'} />
            <Info k="Status" v={data.status} />
            <Info k="Audience" v={data.audience === 'SCHOOL' ? `School · Class ${data.classLevel}` : data.audience ?? '—'} />
            <Info k="Date of birth" v={data.dateOfBirth?.slice(0, 10) ?? '—'} />
            <Info k="Guardian consent" v={data.guardianConsent ? 'Yes' : 'No'} />
            <Info k="Streak" v={`${data.streakDays} days`} />
          </div>
          <div><p className="mb-1 text-xs font-semibold text-gray-500">Target exams</p><p>{data.exams.map((e) => e.exam.nameEn).join(', ') || '—'}</p></div>
          <div className="grid gap-3 sm:grid-cols-3"><Info k="XP" v={String(data.xp)} /><Info k="Tests taken" v={String(data.attempts.filter((a) => a.status !== 'IN_PROGRESS').length)} /><Info k="Orders" v={String(data.orders.length)} /></div>
          <div>
            <p className="mb-1 text-xs font-semibold text-gray-500">Recent attempts</p>
            {data.attempts.length ? data.attempts.slice(0, 8).map((a) => (
              <p key={a.id} className="text-xs">{a.tournament?.titleEn ?? a.test.titleEn} · {a.status.replace('_', ' ')} · {a.score ?? '—'}/{a.maxScore ?? '—'}{a._count.events ? ` · ${a._count.events} integrity events` : ''}</p>
            )) : <p className="text-gray-400">None</p>}
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-gray-500">Orders</p>
            {data.orders.length ? data.orders.map((o) => <p key={o.id} className="text-xs"><Link className="font-mono text-brand-600" to={`/finance/orders/${o.id}`}>{o.receiptNo}</Link> · {o.descriptionEn} · {formatRupees(o.amountPaise)} · {o.status}</p>) : <p className="text-gray-400">None</p>}
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-gray-500">Test series access</p>
            {data.enrollments.length ? data.enrollments.map((e) => <p key={e.id} className="text-xs">{e.series.titleEn} · {e.source} · {e.revokedAt ? 'revoked' : `until ${fmtDate(e.expiresAt)}`}</p>) : <p className="text-gray-400">None</p>}
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-gray-500">Support tickets</p>
            {data.tickets.length ? data.tickets.map((t) => <p key={t.id} className="text-xs"><Link className="text-brand-600" to={`/support/tickets/${t.id}`}>{t.subject}</Link> · {t.category} · {t.status}</p>) : <p className="text-gray-400">None</p>}
          </div>
          <div><p className="mb-1 text-xs font-semibold text-gray-500">Registrations</p>{data.registrations.length ? data.registrations.map((r) => <p key={r.id}>{r.tournament.titleEn} · {r.status}</p>) : <p className="text-gray-400">None yet</p>}</div>
          <div>
            <p className="mb-1 text-xs font-semibold text-gray-500">Enforcement history</p>
            {data.audit.length ? data.audit.map((a) => <p key={a.id} className="text-xs">{fmtDate(a.createdAt)} · {a.action}{a.meta?.reason ? ` — ${a.meta.reason}` : ''}</p>) : <p className="text-xs text-gray-400">No actions</p>}
          </div>
          {can('users.write') && (
            <div className="rounded-xl bg-gray-50 p-4">
              <Field label={data.status === 'ACTIVE' ? 'Reason for suspension (recorded)' : 'Reason for reinstatement (recorded)'}>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <ErrorBox error={setStatus.error} />
              <Button className="mt-3" size="sm" variant={data.status === 'ACTIVE' ? 'danger' : 'primary'} disabled={reason.trim().length < 3 || setStatus.isPending} onClick={() => setStatus.mutate(data.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE')}>
                {data.status === 'ACTIVE' ? 'Suspend account' : 'Reinstate account'}
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return <div className="rounded-xl bg-gray-50 p-3"><p className="text-xs text-gray-500">{k}</p><p className="font-semibold">{v}</p></div>;
}
