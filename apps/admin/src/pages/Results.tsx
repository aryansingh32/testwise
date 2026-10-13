import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatRupees } from '@testwise/shared';
import { ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Badge, Button, Card, Empty, ErrorBox, Field, fmtDate, Input, Modal, PageHeader, statusTone, Table } from '../components/ui';
import { api, can } from '../lib/api';

interface Entry {
  id: string; attemptId: string; userId: string; rank: number | null; score: number; adjustment: number; adjustReason: string | null; accuracy: number; timeTakenSec: number;
  percentile: number | null; disqualified: boolean; dqReason: string | null; rewardEn: string | null; rewardPaise: number; rewardStatus: string; payoutRef: string | null;
  user: { displayName: string; email: string | null } | null; integrity: Record<string, number>;
}
interface ProctorReview {
  attempt: { id: string; status: string; startedAt: string; submittedAt: string | null; user: { displayName: string; email: string | null } };
  events: { id: string; type: string; meta: unknown; at: string; clientAt: string | null; platform: string | null; appVersion: string | null; osVersion: string | null; deviceModel: string | null; riskPoints: number }[];
}
interface AdminResults {
  tournament: { id: string; titleEn: string; status: string; slug: string; fundingSource: string };
  counts: { registered: number; inProgress: number; submitted: number };
  activeAttempts: { id: string; startedAt: string; user: { displayName: string; email: string | null } }[];
  current: { id: string; version: number; status: string; verifyCode: string; publishedAt: string } | null;
  versions: { id: string; version: number; status: string; notes: string | null; publishedAt: string }[];
  entries: Entry[];
}

const rewardTone = (s: string) => (({ ELIGIBLE: 'amber', APPROVED: 'violet', PAID: 'green', WITHHELD: 'red', NONE: 'gray' }) as const)[s as 'NONE'] ?? 'gray';
const API = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export function ResultsPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [action, setAction] = useState<{ entry: Entry; kind: 'DISQUALIFY' | 'REINSTATE' | 'ADJUST' } | null>(null);
  const [form, setForm] = useState({ reason: '', amount: '' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reviewAttempt, setReviewAttempt] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ['results', id], queryFn: () => api<AdminResults>(`/v1/admin/results/${id}`), refetchInterval: 15_000 });
  const { data: review } = useQuery({ queryKey: ['proctor-events', id, reviewAttempt], queryFn: () => api<ProctorReview>(`/v1/admin/results/${id}/attempts/${reviewAttempt}/proctor-events`), enabled: !!reviewAttempt, refetchInterval: 10_000 });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['results', id] });

  const generate = useMutation({ mutationFn: () => api(`/v1/admin/results/${id}/generate`, { method: 'POST' }), onSuccess: refresh });
  const finalize = useMutation({ mutationFn: () => api(`/v1/admin/results/${id}/finalize`, { method: 'POST' }), onSuccess: refresh });
  const reopen = useMutation({ mutationFn: (reason: string) => api(`/v1/admin/results/${id}/reopen`, { method: 'POST', json: { reason } }), onSuccess: refresh });
  const act = useMutation({
    mutationFn: () => api(`/v1/admin/results/${id}/action`, { method: 'POST', json: { userId: action!.entry.userId, action: action!.kind, reason: form.reason, ...(action!.kind === 'ADJUST' && { amount: Number(form.amount) }) } }),
    onSuccess: () => { setAction(null); setForm({ reason: '', amount: '' }); refresh(); },
  });
  const rewards = useMutation({
    mutationFn: (body: { action: string; payoutRef?: string; reason?: string }) => api(`/v1/admin/results/${id}/rewards`, { method: 'POST', json: { userIds: [...selected], ...body } }),
    onSuccess: () => { setSelected(new Set()); refresh(); },
  });

  if (!data) return <p className="text-sm text-gray-500">Loading…</p>;
  const t = data.tournament;
  const inReview = t.status === 'IN_REVIEW';
  const final = ['FINAL', 'REWARDS_APPROVED', 'CLOSED'].includes(t.status);
  const integrityLabel = (i: Record<string, number>) => Object.entries(i).filter(([k]) => k !== 'APP_FOREGROUND' && k !== 'RISK_POINTS').map(([k, v]) => `${k.replace('APP_', '').toLowerCase()} ×${v}`).join(', ');

  return (
    <>
      <Link to={`/tournaments/${t.id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-ink"><ArrowLeft size={14} /> {t.titleEn}</Link>
      <PageHeader
        title="Results"
        subtitle={`${data.counts.registered} registered · ${data.counts.inProgress} writing now · ${data.counts.submitted} submitted`}
        actions={<>
          <Badge tone={statusTone(t.status)}>{t.status.replace('_', ' ')}</Badge>
          {data.current && <Badge tone={data.current.status === 'FINAL' ? 'green' : 'amber'}>v{data.current.version} {data.current.status}</Badge>}
          {data.current?.status === 'FINAL' && <a href={`${API}/verify/${data.current.verifyCode}`} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary"><ExternalLink size={14} /> Public page</Button></a>}
        </>}
      />

      {can('results.write') && (
        <Card className="mb-6">
          <div className="flex flex-wrap items-center gap-3">
            {inReview && <Button size="sm" variant="secondary" onClick={() => generate.mutate()} disabled={generate.isPending}><RefreshCw size={14} /> {data.current ? 'Rebuild from attempts' : 'Generate provisional results'}</Button>}
            {inReview && data.current && <Button size="sm" onClick={() => window.confirm('Finalise results? Students are notified, the answer key may unlock and a public verification page is created.') && finalize.mutate()}>Finalise results</Button>}
            {t.status === 'FINAL' && <Button size="sm" variant="secondary" onClick={() => { const r = window.prompt('Reason for reopening (recorded)'); if (r) reopen.mutate(r); }}>Reopen for corrections</Button>}
            {!inReview && !final && <p className="text-sm text-gray-500">Results can be prepared once the test window closes (tournament status IN REVIEW).</p>}
            {final && <p className="text-sm text-gray-500">Results are frozen. Corrections require reopening (blocked once rewards are approved).</p>}
          </div>
          <div className="mt-3"><ErrorBox error={generate.error ?? finalize.error ?? reopen.error} /></div>
        </Card>
      )}

      {final && can('finance.write') && selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-brand-50 p-3 text-sm">
          <span className="font-semibold">{selected.size} selected</span>
          <Button size="sm" onClick={() => rewards.mutate({ action: 'APPROVE' })}>Approve rewards</Button>
          <Button size="sm" variant="secondary" onClick={() => { const ref = window.prompt('Payout reference (bank/UPI transaction ID or delivery tracking)'); if (ref) rewards.mutate({ action: 'MARK_PAID', payoutRef: ref }); }}>Mark paid / delivered</Button>
          <Button size="sm" variant="secondary" title="Credits approved cash prizes to the students' wallets as earned coins (Wallet settings must allow it)" onClick={() => { if (window.confirm('Credit the approved prizes to the selected students’ wallets as earned coins?')) rewards.mutate({ action: 'PAY_COINS' }); }}>Pay as wallet coins</Button>
          <Button size="sm" variant="secondary" onClick={() => { const reason = window.prompt('Reason for withholding'); if (reason) rewards.mutate({ action: 'WITHHOLD', reason }); }}>Withhold</Button>
        </div>
      )}
      <ErrorBox error={rewards.error} />

      {data.activeAttempts.length > 0 && <Card title="Active attempts" className="mb-4" actions={<span className="text-xs text-gray-500">Review flags and reported device details</span>}>
        <div className="max-h-72 divide-y overflow-auto">
          {data.activeAttempts.map((attempt) => <div key={attempt.id} className="flex items-center justify-between gap-3 py-2">
            <div><p className="text-sm font-semibold">{attempt.user.displayName}</p><p className="text-xs text-gray-500">{attempt.user.email ?? 'No email'} · Started {fmtDate(attempt.startedAt)}</p></div>
            <Button size="sm" variant="secondary" onClick={() => setReviewAttempt(attempt.id)}>Review signals</Button>
          </div>)}
        </div>
      </Card>}

      {!data.entries.length ? (
        <Empty>{inReview ? 'No results yet. Generate provisional results.' : 'No results yet.'}</Empty>
      ) : (
        <Table head={['', 'Rank', 'Student', 'Score', 'Accuracy', 'Time', 'Integrity log', 'Reward', '']}>
          {data.entries.map((e) => (
            <tr key={e.id} className={e.disqualified ? 'bg-red-50/40' : ''}>
              <td className="px-3 py-2">{final && e.rewardStatus !== 'NONE' && <input type="checkbox" checked={selected.has(e.userId)} onChange={() => { const n = new Set(selected); if (n.has(e.userId)) n.delete(e.userId); else n.add(e.userId); setSelected(n); }} />}</td>
              <td className="px-3 py-2 font-bold tabular-nums">{e.rank ?? '—'}</td>
              <td className="px-3 py-2 text-xs"><p className="font-semibold">{e.user?.displayName}</p><p className="text-gray-400">{e.user?.email}</p>{e.disqualified && <p className="text-red-600">DQ: {e.dqReason}</p>}</td>
              <td className="px-3 py-2 text-sm tabular-nums">{(e.score + e.adjustment).toFixed(2)}{e.adjustment !== 0 && <p className="text-[11px] text-violet-700">{e.adjustment > 0 ? '+' : ''}{e.adjustment}: {e.adjustReason}</p>}</td>
              <td className="px-3 py-2 text-xs tabular-nums">{e.accuracy}%</td>
              <td className="px-3 py-2 text-xs tabular-nums">{Math.floor(e.timeTakenSec / 60)}m {e.timeTakenSec % 60}s</td>
              <td className="px-3 py-2 text-xs text-amber-700">{integrityLabel(e.integrity) || <span className="text-gray-300">—</span>}{(e.integrity.RISK_POINTS ?? 0) > 0 && <p className="mt-1 text-[10px] text-gray-500">Review signal points: {e.integrity.RISK_POINTS}</p>}</td>
              <td className="px-3 py-2 text-xs">{e.rewardStatus !== 'NONE' ? <>{[e.rewardPaise ? formatRupees(e.rewardPaise) : null, e.rewardEn].filter(Boolean).join(' + ')}<br /><Badge tone={rewardTone(e.rewardStatus)}>{e.rewardStatus}</Badge>{e.payoutRef && <p className="text-gray-400">{e.payoutRef}</p>}</> : '—'}</td>
              <td className="px-3 py-2 text-right">
                <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={() => setReviewAttempt(e.attemptId)}>Review signals</Button>
                {inReview && can('results.write') && (
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setAction({ entry: e, kind: 'ADJUST' })}>Adjust</Button>
                    {e.disqualified ? <Button size="sm" variant="ghost" onClick={() => setAction({ entry: e, kind: 'REINSTATE' })}>Reinstate</Button> : <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setAction({ entry: e, kind: 'DISQUALIFY' })}>Disqualify</Button>}
                  </div>
                )}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}

      {data.versions.length > 0 && (
        <Card title="Version history" className="mt-6">
          <ul className="space-y-1 text-sm">{data.versions.map((v) => <li key={v.id} className="flex justify-between gap-3"><span>v{v.version} · <Badge tone={v.status === 'FINAL' ? 'green' : v.status === 'PROVISIONAL' ? 'amber' : 'gray'}>{v.status}</Badge> {v.notes}</span><span className="text-xs text-gray-400">{fmtDate(v.publishedAt)}</span></li>)}</ul>
        </Card>
      )}

      <Modal open={!!action} onClose={() => setAction(null)} title={action ? `${action.kind === 'ADJUST' ? 'Adjust score' : action.kind === 'DISQUALIFY' ? 'Disqualify' : 'Reinstate'} · ${action.entry.user?.displayName}` : ''}>
        <div className="space-y-4">
          {action?.kind === 'ADJUST' && <Field label="Adjustment (marks, can be negative)" hint="Replaces any previous adjustment for this student"><Input type="number" step="0.25" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>}
          <Field label="Reason (recorded and visible in the audit log)"><Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
          <p className="text-xs text-gray-500">This creates a new provisional result version and re-ranks everyone.</p>
          <ErrorBox error={act.error} />
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setAction(null)}>Cancel</Button><Button disabled={form.reason.length < 3 || act.isPending} onClick={() => act.mutate()}>Confirm</Button></div>
        </div>
      </Modal>

      <Modal open={!!reviewAttempt} onClose={() => setReviewAttempt(null)} title={`Proctor review · ${review?.attempt.user.displayName ?? 'Loading…'}`} wide>
        <div className="space-y-4">
          {review && <>
            <p className="text-xs text-gray-500">Attempt {review.attempt.status} · {review.attempt.user.email ?? 'No email'} · Events are review signals, not a finding of misconduct.</p>
            {review.events.some((event) => event.deviceModel || event.platform) && <Card title="Reported device">
              <p className="text-sm">{[review.events.find((e) => e.deviceModel)?.deviceModel, review.events.find((e) => e.platform)?.platform, review.events.find((e) => e.osVersion)?.osVersion, review.events.find((e) => e.appVersion)?.appVersion].filter(Boolean).join(' · ') || 'No device metadata reported'}</p>
            </Card>}
            <div className="max-h-[50vh] space-y-2 overflow-auto">
              {review.events.map((event) => <div key={event.id} className="rounded-lg border border-gray-100 p-3">
                <div className="flex items-center justify-between gap-3"><span className="font-semibold text-sm">{event.type.replaceAll('_', ' ')}</span><span className="text-xs text-gray-500">{fmtDate(event.at)}</span></div>
                <p className="mt-1 text-xs text-gray-500">{event.clientAt ? `Device time ${fmtDate(event.clientAt)} · ` : ''}{event.riskPoints ? `${event.riskPoints} review points` : 'No score impact'}</p>
                {event.meta != null && <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-gray-600">{JSON.stringify(event.meta, null, 2)}</pre>}
              </div>)}
              {!review.events.length && <p className="text-sm text-gray-500">No events recorded.</p>}
            </div>
            {review.attempt.status === 'IN_PROGRESS' && can('results.write') && <Button size="sm" variant="secondary" onClick={() => {
              const reason = window.prompt('Message to the student (delivered in their app and recorded for review)');
              if (reason && reason.trim().length >= 3) void api<{ notificationQueued: boolean }>(`/v1/admin/results/${id}/attempts/${reviewAttempt}/warn`, { method: 'POST', json: { reason } }).then((result) => window.alert(result.notificationQueued ? 'Warning sent' : 'Warning recorded, but notification delivery is disabled')).catch((error) => window.alert((error as Error).message));
            }}>Send student warning</Button>}
          </>}
        </div>
      </Modal>
    </>
  );
}

