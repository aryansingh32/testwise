import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CATEGORY_INFO, type NotificationCategory } from '@testwise/shared';
import { CheckCircle2, Pencil, RotateCcw, Send, Smartphone, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Button, Card, Empty, ErrorBox, Field, fmtDate, fromLocalInput, Input, Modal, PageHeader, Select, Table, Textarea, Toggle, cx } from '../components/ui';
import { api, can } from '../lib/api';
import { useTaxonomy } from '../lib/hooks';

type Tab = 'compose' | 'campaigns' | 'templates' | 'deliveries' | 'setup';
const CATEGORIES = Object.keys(CATEGORY_INFO) as NotificationCategory[];

export function NotificationsPage() {
  const [tab, setTab] = useState<Tab>('compose');
  return (
    <>
      <PageHeader title="Notifications" subtitle="Push notifications (phone notification bar) and the in-app inbox. Automatic events use editable templates; custom messages go to one student, a list, a tournament, an exam, a segment or everyone." />
      <div className="mb-5 flex w-fit flex-wrap gap-1 rounded-xl bg-gray-100 p-1 text-sm font-semibold">
        {(['compose', 'campaigns', 'templates', 'deliveries', 'setup'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx('rounded-lg px-4 py-1.5 capitalize', tab === t && 'bg-white shadow')}>{t === 'setup' ? 'Push setup' : t}</button>
        ))}
      </div>
      {tab === 'compose' && <Compose onSent={() => setTab('campaigns')} />}
      {tab === 'campaigns' && <Campaigns />}
      {tab === 'templates' && <Templates />}
      {tab === 'deliveries' && <Deliveries />}
      {tab === 'setup' && <Setup />}
    </>
  );
}

function Compose({ onSent }: { onSent: () => void }) {
  const qc = useQueryClient();
  const { data: tax } = useTaxonomy();
  const tournaments = useQuery({ queryKey: ['tournaments', '', ''], queryFn: () => api<{ id: string; titleEn: string; status: string }[]>('/v1/admin/tournaments') });
  const [f, setF] = useState({
    audience: 'USERS', userRefs: '', tournamentId: '', examId: '', segAudience: '', segClasses: [] as number[], inactiveDays: '',
    category: 'TOURNAMENTS', titleEn: '', titleHi: '', bodyEn: '', bodyHi: '', link: '', push: true, inbox: true, schedule: false, sendAt: '',
  });
  const refs = useMemo(() => f.userRefs.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean), [f.userRefs]);
  const body = () => ({
    audience: f.audience, userRefs: refs, tournamentId: f.tournamentId || null, examId: f.examId || null,
    segment: f.audience === 'SEGMENT' ? { audience: f.segAudience || null, classLevels: f.segClasses, inactiveDays: f.inactiveDays ? Number(f.inactiveDays) : null } : null,
    category: f.category, titleEn: f.titleEn, titleHi: f.titleHi || null, bodyEn: f.bodyEn, bodyHi: f.bodyHi || null, link: f.link || null,
    push: f.push, inbox: f.inbox, sendAt: f.schedule && f.sendAt ? fromLocalInput(f.sendAt) : null,
  });
  const preview = useMutation({ mutationFn: () => api<{ students: number; devices: number; notFound: string[] }>('/v1/admin/notifications/campaigns/preview', { method: 'POST', json: body() }) });
  const send = useMutation({
    mutationFn: () => api('/v1/admin/notifications/campaigns', { method: 'POST', json: body() }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['campaigns'] }); onSent(); },
  });

  async function loadCsv(file: File) {
    const text = await file.text();
    const emails = text.match(/[^\s,;"']+@[^\s,;"']+/g) ?? [];
    setF((p) => ({ ...p, audience: 'USERS', userRefs: [...new Set([...refs, ...emails])].join('\n') }));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <Card title="New notification">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Send to">
              <Select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>
                <option value="USERS">Specific students (one or many)</option>
                <option value="TOURNAMENT">Everyone registered for a tournament</option>
                <option value="EXAM">Students following an exam</option>
                <option value="SEGMENT">A segment (school/exam, class, inactivity)</option>
                <option value="ALL">All students</option>
              </Select>
            </Field>
            <Field label="Category" hint="Students can mute some categories in the app">
              <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_INFO[c].labelEn}{CATEGORY_INFO[c].mutable ? '' : ' (always delivered)'}</option>)}
              </Select>
            </Field>
          </div>
          {f.audience === 'USERS' && (
            <Field label={`Students (${refs.length})`} hint="Emails or student IDs, one per line or comma separated. You can also upload a CSV.">
              <Textarea rows={4} value={f.userRefs} onChange={(e) => setF({ ...f, userRefs: e.target.value })} placeholder={'riya@example.com\nkabir@example.com'} />
              <label className="mt-2 inline-block cursor-pointer text-xs font-semibold text-brand-600">Upload CSV<input type="file" accept=".csv,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && void loadCsv(e.target.files[0])} /></label>
            </Field>
          )}
          {f.audience === 'TOURNAMENT' && (
            <Field label="Tournament"><Select value={f.tournamentId} onChange={(e) => setF({ ...f, tournamentId: e.target.value })}><option value="">Select…</option>{tournaments.data?.map((t) => <option key={t.id} value={t.id}>{t.titleEn} ({t.status})</option>)}</Select></Field>
          )}
          {f.audience === 'EXAM' && (
            <Field label="Exam"><Select value={f.examId} onChange={(e) => setF({ ...f, examId: e.target.value })}><option value="">Select…</option>{tax?.exams.map((e) => <option key={e.id} value={e.id}>{e.nameEn}</option>)}</Select></Field>
          )}
          {f.audience === 'SEGMENT' && (
            <div className="grid gap-4 rounded-xl bg-gray-50 p-3 sm:grid-cols-3">
              <Field label="Audience"><Select value={f.segAudience} onChange={(e) => setF({ ...f, segAudience: e.target.value })}><option value="">Everyone</option><option value="SCHOOL">School students</option><option value="EXAM">Exam aspirants</option></Select></Field>
              <Field label="Classes">
                <div className="flex flex-wrap gap-1 pt-1">{[6, 7, 8, 9, 10, 11, 12].map((c) => <button type="button" key={c} onClick={() => setF({ ...f, segClasses: f.segClasses.includes(c) ? f.segClasses.filter((x) => x !== c) : [...f.segClasses, c] })} className={cx('h-7 w-8 rounded-md text-xs font-bold', f.segClasses.includes(c) ? 'bg-brand-500 text-white' : 'bg-white')}>{c}</button>)}</div>
              </Field>
              <Field label="Inactive for (days)" hint="Win-back messages"><Input type="number" min={0} value={f.inactiveDays} onChange={(e) => setF({ ...f, inactiveDays: e.target.value })} /></Field>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title (English)"><Input value={f.titleEn} onChange={(e) => setF({ ...f, titleEn: e.target.value })} maxLength={120} /></Field>
            <Field label="शीर्षक (Hindi)"><Input className="hindi" value={f.titleHi} onChange={(e) => setF({ ...f, titleHi: e.target.value })} maxLength={120} /></Field>
            <Field label="Message (English)"><Textarea value={f.bodyEn} onChange={(e) => setF({ ...f, bodyEn: e.target.value })} /></Field>
            <Field label="संदेश (Hindi)"><Textarea className="hindi" value={f.bodyHi} onChange={(e) => setF({ ...f, bodyHi: e.target.value })} /></Field>
          </div>
          <Field label="Opens in app (optional)" hint="/tournament/<slug>, /series/<slug>, /duels, /store, /tests, /orders, /support or a https:// link"><Input value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} /></Field>
          <div className="flex flex-wrap items-center gap-6">
            <Toggle checked={f.push} onChange={(v) => setF({ ...f, push: v })} label="Push to phone" />
            <Toggle checked={f.inbox} onChange={(v) => setF({ ...f, inbox: v })} label="Show in app inbox" />
            <Toggle checked={f.schedule} onChange={(v) => setF({ ...f, schedule: v })} label="Schedule" />
            {f.schedule && <Input type="datetime-local" className="w-56" value={f.sendAt} onChange={(e) => setF({ ...f, sendAt: e.target.value })} />}
          </div>
          <ErrorBox error={preview.error ?? send.error} />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => preview.mutate()} disabled={!f.titleEn || !f.bodyEn}>Check audience</Button>
            <Button onClick={() => window.confirm(`Send "${f.titleEn}"${preview.data ? ` to ${preview.data.students} students` : ''}?`) && send.mutate()} disabled={!f.titleEn || !f.bodyEn || send.isPending || !can('notify.send')}>
              <Send size={14} /> {f.schedule ? 'Schedule' : 'Send now'}
            </Button>
          </div>
          {preview.data && (
            <div className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900">
              Reaches <b>{preview.data.students}</b> students with <b>{preview.data.devices}</b> phones registered for push.
              {preview.data.notFound.length > 0 && <p className="mt-1 text-red-700">Not found: {preview.data.notFound.slice(0, 10).join(', ')}{preview.data.notFound.length > 10 ? '…' : ''}</p>}
            </div>
          )}
        </div>
      </Card>
      <Card title="Phone preview">
        <div className="rounded-3xl bg-gray-900 p-4">
          <div className="rounded-2xl bg-white/95 p-3 shadow">
            <div className="flex items-center gap-2 text-[11px] text-gray-500"><span className="flex h-4 w-4 items-center justify-center rounded bg-brand-500 text-[9px] font-bold text-white">T</span> Testwise · now</div>
            <p className="mt-1 text-sm font-bold">{f.titleEn || 'Title'}</p>
            <p className="text-xs text-gray-600">{f.bodyEn || 'Message'}</p>
          </div>
          {f.titleHi && (
            <div className="mt-2 rounded-2xl bg-white/95 p-3 shadow">
              <div className="text-[11px] text-gray-500">Testwise · हिन्दी</div>
              <p className="hindi mt-1 text-sm font-bold">{f.titleHi}</p>
              <p className="hindi text-xs text-gray-600">{f.bodyHi || f.bodyEn}</p>
            </div>
          )}
        </div>
        <p className="mt-3 text-xs text-gray-500">Students see the language they chose in the app. Promotional pushes wait until quiet hours end (Settings → Notification timing).</p>
      </Card>
    </div>
  );
}

interface CampaignRow {
  id: string; audience: string; category: string; titleEn: string; bodyEn: string; push: boolean; inbox: boolean; status: string; sendAt: string; sentAt: string | null; targetCount: number; error: string | null;
  stats: { pushSent: number; pushFailed: number; pushSkipped: number; pushPending: boolean; opened: number };
}

function Campaigns() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['campaigns'], queryFn: () => api<CampaignRow[]>('/v1/admin/notifications/campaigns'), refetchInterval: 5000 });
  const cancel = useMutation({ mutationFn: (id: string) => api(`/v1/admin/notifications/campaigns/${id}/cancel`, { method: 'POST' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['campaigns'] }) });
  if (!data?.length) return <Empty>No custom notifications sent yet.</Empty>;
  const tone = (s: string) => (({ SENT: 'green', SENDING: 'blue', SCHEDULED: 'amber', CANCELLED: 'gray', FAILED: 'red' }) as const)[s as 'SENT'] ?? 'gray';
  return (
    <Table head={['Message', 'Audience', 'Status', 'Recipients', 'Push sent / failed / skipped', 'Opened', '']}>
      {data.map((c) => (
        <tr key={c.id}>
          <td className="max-w-sm px-4 py-3"><p className="font-semibold">{c.titleEn}</p><p className="line-clamp-1 text-xs text-gray-500">{c.bodyEn}</p><p className="text-[11px] text-gray-400">{CATEGORY_INFO[c.category as NotificationCategory]?.labelEn} · {c.push ? 'push' : ''}{c.push && c.inbox ? ' + ' : ''}{c.inbox ? 'inbox' : ''}</p></td>
          <td className="px-4 py-3 text-xs">{c.audience}</td>
          <td className="px-4 py-3"><Badge tone={tone(c.status)}>{c.status}</Badge><p className="mt-1 text-[11px] text-gray-400">{fmtDate(c.sentAt ?? c.sendAt)}</p>{c.error && <p className="text-[11px] text-red-600">{c.error}</p>}</td>
          <td className="px-4 py-3 text-sm tabular-nums">{c.targetCount}</td>
          <td className="px-4 py-3 text-xs tabular-nums">{c.stats.pushSent} / {c.stats.pushFailed} / {c.stats.pushSkipped}{c.stats.pushPending && <span className="ml-1 text-amber-600">sending…</span>}</td>
          <td className="px-4 py-3 text-sm tabular-nums">{c.stats.opened}</td>
          <td className="px-4 py-3 text-right">{c.status === 'SCHEDULED' && can('notify.send') && <Button size="sm" variant="ghost" onClick={() => cancel.mutate(c.id)}>Cancel</Button>}</td>
        </tr>
      ))}
    </Table>
  );
}

interface TemplateRow { key: string; category: NotificationCategory; descriptionEn: string; vars: string[]; titleEn: string; titleHi: string; bodyEn: string; bodyHi: string; push: boolean; inbox: boolean; enabled: boolean; customised: boolean }

function Templates() {
  const qc = useQueryClient();
  const [cat, setCat] = useState<string>('');
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const { data } = useQuery({ queryKey: ['templates'], queryFn: () => api<TemplateRow[]>('/v1/admin/notifications/templates') });
  const save = useMutation({
    mutationFn: (t: TemplateRow) => api(`/v1/admin/notifications/templates/${t.key}`, { method: 'PUT', json: { titleEn: t.titleEn, titleHi: t.titleHi, bodyEn: t.bodyEn, bodyHi: t.bodyHi, push: t.push, inbox: t.inbox, enabled: t.enabled } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['templates'] }); setEditing(null); },
  });
  const reset = useMutation({ mutationFn: (key: string) => api(`/v1/admin/notifications/templates/${key}`, { method: 'DELETE' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['templates'] }) });
  const rows = (data ?? []).filter((t) => !cat || t.category === cat);
  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <Select value={cat} onChange={(e) => setCat(e.target.value)} className="max-w-xs"><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_INFO[c].labelEn}</option>)}</Select>
        <p className="text-sm text-gray-500">{data?.length ?? 0} automatic notifications. Turn any off, choose push/inbox, or rewrite the text in both languages.</p>
      </div>
      <Table head={['Event', 'Text (English)', 'Push', 'Inbox', 'On', '']}>
        {rows.map((t) => (
          <tr key={t.key} className={t.enabled ? '' : 'opacity-50'}>
            <td className="px-4 py-3"><p className="font-mono text-xs font-bold">{t.key}</p><p className="text-xs text-gray-500">{t.descriptionEn}</p><Badge tone="blue">{CATEGORY_INFO[t.category].labelEn}</Badge> {t.customised && <Badge tone="amber">edited</Badge>}</td>
            <td className="max-w-md px-4 py-3 text-xs"><p className="font-semibold">{t.titleEn}</p><p className="text-gray-500">{t.bodyEn}</p></td>
            <td className="px-4 py-3">{t.push ? <CheckCircle2 size={16} className="text-emerald-600" /> : <XCircle size={16} className="text-gray-300" />}</td>
            <td className="px-4 py-3">{t.inbox ? <CheckCircle2 size={16} className="text-emerald-600" /> : <XCircle size={16} className="text-gray-300" />}</td>
            <td className="px-4 py-3"><Toggle checked={t.enabled} disabled={!can('notify.send')} onChange={(v) => save.mutate({ ...t, enabled: v })} /></td>
            <td className="px-4 py-3 text-right">
              {can('notify.send') && <div className="flex justify-end gap-1"><button className="p-1 text-gray-400 hover:text-ink" onClick={() => setEditing(t)} aria-label="Edit"><Pencil size={14} /></button>{t.customised && <button className="p-1 text-gray-400 hover:text-ink" onClick={() => reset.mutate(t.key)} title="Reset to default" aria-label="Reset"><RotateCcw size={14} /></button>}</div>}
            </td>
          </tr>
        ))}
      </Table>
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing.key} wide>
          <p className="mb-3 text-sm text-gray-500">{editing.descriptionEn}. Variables: {editing.vars.length ? editing.vars.map((v) => <code key={v} className="mr-1 rounded bg-gray-100 px-1">{`{{${v}}}`}</code>) : 'none'}</p>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Title (English)"><Input value={editing.titleEn} onChange={(e) => setEditing({ ...editing, titleEn: e.target.value })} /></Field>
            <Field label="शीर्षक (Hindi)"><Input className="hindi" value={editing.titleHi} onChange={(e) => setEditing({ ...editing, titleHi: e.target.value })} /></Field>
            <Field label="Message (English)"><Textarea value={editing.bodyEn} onChange={(e) => setEditing({ ...editing, bodyEn: e.target.value })} /></Field>
            <Field label="संदेश (Hindi)"><Textarea className="hindi" value={editing.bodyHi} onChange={(e) => setEditing({ ...editing, bodyHi: e.target.value })} /></Field>
          </div>
          <div className="mt-4 flex gap-6"><Toggle checked={editing.push} onChange={(v) => setEditing({ ...editing, push: v })} label="Push to phone" /><Toggle checked={editing.inbox} onChange={(v) => setEditing({ ...editing, inbox: v })} label="In-app inbox" /><Toggle checked={editing.enabled} onChange={(v) => setEditing({ ...editing, enabled: v })} label="Enabled" /></div>
          <div className="mt-4"><ErrorBox error={save.error} /></div>
          <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={() => save.mutate(editing)} disabled={save.isPending}>Save</Button></div>
        </Modal>
      )}
    </>
  );
}

function Deliveries() {
  const [status, setStatus] = useState('');
  const [userRef, setUserRef] = useState('');
  const { data } = useQuery({
    queryKey: ['deliveries', status, userRef],
    queryFn: () => api<{ id: string; status: string; error: string | null; provider: string; platform: string | null; createdAt: string; title: string; eventKey: string | null; user: { email: string | null; displayName: string } | null }[]>(`/v1/admin/notifications/deliveries?${new URLSearchParams({ ...(status && { status }), ...(userRef && { userRef }) })}`),
    refetchInterval: 5000,
  });
  const tone = (s: string) => (({ SENT: 'green', FAILED: 'red', INVALID_TOKEN: 'amber', SKIPPED: 'gray' }) as const)[s as 'SENT'] ?? 'gray';
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-3">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[200px]"><option value="">All results</option>{['SENT', 'FAILED', 'INVALID_TOKEN', 'SKIPPED'].map((s) => <option key={s}>{s}</option>)}</Select>
        <Input placeholder="Student email — press Enter" className="max-w-xs" onKeyDown={(e) => e.key === 'Enter' && setUserRef(e.currentTarget.value)} />
      </div>
      {!data?.length ? <Empty>No push deliveries yet.</Empty> : (
        <Table head={['When', 'Student', 'Notification', 'Device', 'Result']}>
          {data.map((d) => (
            <tr key={d.id}>
              <td className="px-4 py-2 text-xs text-gray-500">{fmtDate(d.createdAt)}</td>
              <td className="px-4 py-2 text-xs">{d.user?.displayName}<p className="text-gray-400">{d.user?.email}</p></td>
              <td className="px-4 py-2 text-xs"><p className="font-semibold">{d.title}</p><p className="font-mono text-gray-400">{d.eventKey}</p></td>
              <td className="px-4 py-2 text-xs">{d.platform ?? '—'} · {d.provider}</td>
              <td className="px-4 py-2 text-xs"><Badge tone={tone(d.status)}>{d.status}</Badge>{d.error && <p className="mt-1 max-w-xs text-gray-500">{d.error}</p>}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

function Setup() {
  const [userRef, setUserRef] = useState('');
  const { data } = useQuery({ queryKey: ['push-status'], queryFn: () => api<{ providers: { provider: string; configured: boolean; hint: string }[]; devices: { platform: string; provider: string; count: number }[]; queue: { pending: number; failedJobs: number }; last24h: Record<string, number> }>('/v1/admin/notifications/status'), refetchInterval: 10_000 });
  const test = useMutation({ mutationFn: () => api<{ devices: number }>('/v1/admin/notifications/test', { method: 'POST', json: { userRef } }) });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Providers">
        <ul className="space-y-3">
          {data?.providers.map((p) => (
            <li key={p.provider} className="flex items-start justify-between gap-3">
              <div><p className="font-semibold">{p.provider === 'FCM' ? 'Firebase Cloud Messaging (Android)' : 'Apple Push Notification service (iOS)'}</p><p className="text-xs text-gray-500">{p.hint}</p></div>
              <Badge tone={p.configured ? 'green' : 'gray'}>{p.configured ? 'configured' : 'not configured'}</Badge>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-gray-500">Push only reaches phones running a development or store build of the app (not Expo Go or the web). Until a provider is configured, pushes are recorded as skipped and students still get the in-app inbox.</p>
      </Card>
      <Card title="Registered phones">
        {!data?.devices.length ? <p className="text-sm text-gray-500">No phones have registered for push yet.</p> : (
          <ul className="space-y-2 text-sm">{data.devices.map((d) => <li key={`${d.platform}${d.provider}`} className="flex justify-between"><span className="flex items-center gap-2"><Smartphone size={14} /> {d.platform} · {d.provider}</span><b>{d.count}</b></li>)}</ul>
        )}
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-xl bg-gray-50 p-2"><p className="text-lg font-bold">{data?.queue.pending ?? 0}</p>queued</div>
          <div className="rounded-xl bg-gray-50 p-2"><p className="text-lg font-bold">{data?.last24h.SENT ?? 0}</p>sent (24 h)</div>
          <div className="rounded-xl bg-gray-50 p-2"><p className="text-lg font-bold">{(data?.last24h.FAILED ?? 0) + (data?.last24h.INVALID_TOKEN ?? 0)}</p>failed (24 h)</div>
        </div>
      </Card>
      <Card title="Send a test push">
        <div className="flex gap-2"><Input placeholder="Student email or ID" value={userRef} onChange={(e) => setUserRef(e.target.value)} /><Button onClick={() => test.mutate()} disabled={!userRef || test.isPending}>Send</Button></div>
        {test.data && <p className="mt-2 text-sm text-emerald-700">Queued for {test.data.devices} phone(s). Check Deliveries for the result.</p>}
        <div className="mt-2"><ErrorBox error={test.error} /></div>
      </Card>
    </div>
  );
}
