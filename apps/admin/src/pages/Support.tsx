import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Badge, Button, Card, Empty, ErrorBox, Field, fmtDate, Input, Modal, PageHeader, Pager, Select, Table, Textarea, Toggle, cx } from '../components/ui';
import { api, can } from '../lib/api';

const ticketTone = (s: string) => (({ OPEN: 'amber', ANSWERED: 'blue', CLOSED: 'gray' }) as const)[s as 'OPEN'] ?? 'gray';

export function SupportPage() {
  const [tab, setTab] = useState<'tickets' | 'faqs'>('tickets');
  return (
    <>
      <PageHeader title="Support & FAQs" subtitle="Student tickets (including result appeals, payment issues and deletion requests) and the FAQ shown in the app." />
      <div className="mb-5 flex w-fit gap-1 rounded-xl bg-gray-100 p-1 text-sm font-semibold">
        {(['tickets', 'faqs'] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={cx('rounded-lg px-4 py-1.5', tab === t && 'bg-white shadow')}>{t === 'tickets' ? 'Tickets' : 'FAQs'}</button>)}
      </div>
      {tab === 'tickets' ? <Tickets /> : <Faqs />}
    </>
  );
}

function Tickets() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('OPEN');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const { data } = useQuery({
    queryKey: ['tickets', status, category, page],
    queryFn: () => api<{ items: { id: string; subject: string; category: string; status: string; updatedAt: string; user: { displayName: string; email: string | null }; _count: { messages: number } }[]; total: number; page: number; pageSize: number }>(`/v1/admin/support/tickets?${new URLSearchParams({ ...(status && { status }), ...(category && { category }), page: String(page) })}`),
  });
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-3">
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="max-w-[180px]"><option value="">All statuses</option>{['OPEN', 'ANSWERED', 'CLOSED'].map((s) => <option key={s}>{s}</option>)}</Select>
        <Select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} className="max-w-[200px]"><option value="">All categories</option>{['GENERAL', 'PAYMENT', 'RESULT_APPEAL', 'TECHNICAL', 'ACCOUNT', 'DATA_DELETION'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select>
      </div>
      {!data?.items.length ? <Empty>No tickets.</Empty> : (
        <>
          <Table head={['Subject', 'Student', 'Category', 'Status', 'Updated']}>
            {data.items.map((t) => (
              <tr key={t.id} className="cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/support/tickets/${t.id}`)}>
                <td className="px-4 py-3 font-medium">{t.subject}<p className="text-xs text-gray-400">{t._count.messages} messages</p></td>
                <td className="px-4 py-3 text-xs">{t.user.displayName}<p className="text-gray-400">{t.user.email}</p></td>
                <td className="px-4 py-3 text-xs">{t.category.replace('_', ' ')}</td>
                <td className="px-4 py-3"><Badge tone={ticketTone(t.status)}>{t.status}</Badge></td>
                <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(t.updatedAt)}</td>
              </tr>
            ))}
          </Table>
          <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </>
  );
}

export function TicketPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [reply, setReply] = useState('');
  const { data: t } = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => api<{ id: string; subject: string; category: string; status: string; tournamentId: string | null; orderId: string | null; createdAt: string; user: { id: string; displayName: string; email: string | null }; messages: { id: string; fromAdmin: boolean; body: string; createdAt: string }[] }>(`/v1/admin/support/tickets/${id}`),
  });
  const send = useMutation({
    mutationFn: (close: boolean) => api(`/v1/admin/support/tickets/${id}/reply`, { method: 'POST', json: { body: reply, close } }),
    onSuccess: () => { setReply(''); void qc.invalidateQueries({ queryKey: ['ticket', id] }); void qc.invalidateQueries({ queryKey: ['tickets'] }); },
  });
  const del = useMutation({
    mutationFn: (reason: string) => api(`/v1/admin/support/users/${t!.user.id}/delete`, { method: 'POST', json: { reason } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ticket', id] }),
  });
  if (!t) return <p className="text-sm text-gray-500">Loading…</p>;
  return (
    <>
      <Link to="/support" className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-ink"><ArrowLeft size={14} /> Support</Link>
      <PageHeader title={t.subject} subtitle={`${t.user.displayName} · ${t.user.email ?? 'no email'} · ${t.category.replace('_', ' ')}`} actions={<Badge tone={ticketTone(t.status)}>{t.status}</Badge>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <Card>
          <ul className="space-y-3">
            {t.messages.map((m) => (
              <li key={m.id} className={cx('max-w-[85%] rounded-2xl p-3 text-sm', m.fromAdmin ? 'ml-auto bg-brand-50' : 'bg-gray-50')}>
                <p className="whitespace-pre-wrap">{m.body}</p>
                <p className="mt-1 text-[11px] text-gray-400">{m.fromAdmin ? 'Support' : t.user.displayName} · {fmtDate(m.createdAt)}</p>
              </li>
            ))}
          </ul>
          {can('support.write') && (
            <div className="mt-4 space-y-2">
              <Textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply… the student gets a notification" />
              <ErrorBox error={send.error} />
              <div className="flex gap-2"><Button size="sm" disabled={!reply.trim()} onClick={() => send.mutate(false)}>Reply</Button><Button size="sm" variant="secondary" disabled={!reply.trim()} onClick={() => send.mutate(true)}>Reply & close</Button></div>
            </div>
          )}
        </Card>
        <div className="space-y-4">
          <Card title="Links">
            <ul className="space-y-1 text-sm">
              <li><Link className="text-brand-600" to={`/users?q=${encodeURIComponent(t.user.email ?? t.user.id)}`}>Student profile</Link></li>
              {t.orderId && <li><Link className="text-brand-600" to={`/finance/orders/${t.orderId}`}>Related order</Link></li>}
              {t.tournamentId && <li><Link className="text-brand-600" to={`/tournaments/${t.tournamentId}/results`}>Tournament results</Link></li>}
            </ul>
          </Card>
          {t.category === 'DATA_DELETION' && can('users.write') && (
            <Card title="Account deletion">
              <p className="mb-3 text-xs text-gray-500">Anonymises the profile and signs the student out everywhere. Orders, ledger and results stay (anonymised) for audit. Blocked while refunds or rewards are pending.</p>
              <Button size="sm" variant="danger" onClick={() => { const r = window.prompt('Confirm deletion: type a reason'); if (r) del.mutate(r); }}>Delete account</Button>
              {del.isSuccess && <p className="mt-2 text-xs text-emerald-600">Account deleted.</p>}
              <ErrorBox error={del.error} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

interface Faq { id: string; category: string; questionEn: string; questionHi: string | null; answerEn: string; answerHi: string | null; sortOrder: number; active: boolean }

function Faqs() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<Faq> | null>(null);
  const { data } = useQuery({ queryKey: ['faqs'], queryFn: () => api<Faq[]>('/v1/admin/support/faqs') });
  const del = useMutation({ mutationFn: (id: string) => api(`/v1/admin/support/faqs/${id}`, { method: 'DELETE' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['faqs'] }) });
  return (
    <>
      {can('support.write') && <Button className="mb-4" onClick={() => setEditing({ category: 'General', active: true, sortOrder: 0 })}><Plus size={16} /> New FAQ</Button>}
      {!data?.length ? <Empty>No FAQs.</Empty> : (
        <div className="space-y-3">
          {data.map((f) => (
            <Card key={f.id}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase text-gray-400">{f.category} {!f.active && <Badge>hidden</Badge>}</p>
                  <p className="font-semibold">{f.questionEn}</p>
                  {f.questionHi && <p className="hindi text-sm text-gray-500">{f.questionHi}</p>}
                  <p className="mt-1 text-sm text-gray-600">{f.answerEn}</p>
                </div>
                {can('support.write') && <div className="flex gap-1"><button onClick={() => setEditing(f)} className="p-1 text-gray-400 hover:text-ink" aria-label="Edit"><Pencil size={14} /></button><button onClick={() => window.confirm('Delete FAQ?') && del.mutate(f.id)} className="p-1 text-gray-400 hover:text-red-600" aria-label="Delete"><Trash2 size={14} /></button></div>}
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && <FaqForm initial={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function FaqForm({ initial, onClose }: { initial: Partial<Faq>; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ category: initial.category ?? 'General', questionEn: initial.questionEn ?? '', questionHi: initial.questionHi ?? '', answerEn: initial.answerEn ?? '', answerHi: initial.answerHi ?? '', sortOrder: initial.sortOrder ?? 0, active: initial.active ?? true });
  const save = useMutation({
    mutationFn: () => { const body = { ...f, questionHi: f.questionHi || null, answerHi: f.answerHi || null }; return initial.id ? api(`/v1/admin/support/faqs/${initial.id}`, { method: 'PUT', json: body }) : api('/v1/admin/support/faqs', { method: 'POST', json: body }); },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['faqs'] }); onClose(); },
  });
  return (
    <Modal open onClose={onClose} title={initial.id ? 'Edit FAQ' : 'New FAQ'} wide>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Category"><Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
        <Field label="Order"><Input type="number" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: Number(e.target.value) })} /></Field>
        <Field label="Question (English)"><Input value={f.questionEn} onChange={(e) => setF({ ...f, questionEn: e.target.value })} /></Field>
        <Field label="प्रश्न (Hindi)"><Input className="hindi" value={f.questionHi} onChange={(e) => setF({ ...f, questionHi: e.target.value })} /></Field>
        <Field label="Answer (English)"><Textarea rows={4} value={f.answerEn} onChange={(e) => setF({ ...f, answerEn: e.target.value })} /></Field>
        <Field label="उत्तर (Hindi)"><Textarea rows={4} className="hindi" value={f.answerHi} onChange={(e) => setF({ ...f, answerHi: e.target.value })} /></Field>
        <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Visible in app" />
      </div>
      <div className="mt-4"><ErrorBox error={save.error} /></div>
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button></div>
    </Modal>
  );
}
