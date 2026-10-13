import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminPaidDuelOfferDto } from '@testwise/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { AudiencePicker, eligibilityToApi, type EligibilityForm } from '../components/AudiencePicker';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal } from '../components/ui';
import { api, can } from '../lib/api';
import { useTaxonomy } from '../lib/hooks';

const STATUS_TONE = { DRAFT: 'gray', LIVE: 'green', PAUSED: 'amber', CLOSED: 'red' } as const;
const ROOM_TONE: Record<string, 'gray' | 'amber' | 'blue' | 'green' | 'red'> = { OPEN: 'gray', WAITING: 'amber', MATCHED: 'blue', ACTIVE: 'blue', FINISHED: 'green', CANCELLED: 'red' };

/** Admin-created coin duels: batches of identical 1v1 rooms. Money moves only on the server (escrow → prize/refund). */
export function PaidDuelsPanel() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const offers = useQuery({ queryKey: ['paid-duels'], queryFn: () => api<AdminPaidDuelOfferDto[]>('/v1/admin/paid-duels'), refetchInterval: 10_000 });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) => api(`/v1/admin/paid-duels/${id}`, { method: 'PATCH', json: body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['paid-duels'] }),
  });
  const cancel = useMutation({
    mutationFn: (roomId: string) => api(`/v1/admin/paid-duels/rooms/${roomId}/cancel`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['paid-duels'] }),
  });
  const totals = (offers.data ?? []).reduce((t, o) => ({ escrow: t.escrow + o.escrowCoins, fees: t.fees + o.feesCoins, playing: t.playing + o.playingRooms, waiting: t.waiting + o.waitingRooms }), { escrow: 0, fees: 0, playing: 0, waiting: 0 });
  return (
    <div className="mt-6 space-y-4">
      <div className="grid gap-4 sm:grid-cols-4">
        {[['Coins in escrow', totals.escrow], ['Platform fees kept', totals.fees], ['Duels in play', totals.playing], ['Players waiting', totals.waiting]].map(([k, v]) => (
          <Card key={k as string}><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{k}</p><p className="mt-2 text-2xl font-extrabold tabular-nums">{v}</p></Card>
        ))}
      </div>
      <Card
        title="Coin duels"
        actions={can('tournament.write') && <Button size="sm" onClick={() => setCreating(true)}><Plus size={14} /> Create coin duels</Button>}
      >
        <p className="mb-3 text-xs text-gray-500">
          Each batch makes identical 1v1 rooms (e.g. 20 rooms, entry 50 coins, prize 75 or 100). Entries are held in escrow by the server, the winner is paid from the server’s own result, and a draw, no-show or cancelled room refunds both players. Turn the whole feature on, and choose which coins may pay entry, in <Link className="font-semibold text-brand-600" to="/settings#duels.paid">Settings → Paid coin duels</Link>. Every movement is in the coin ledger.
        </p>
        <ErrorBox error={offers.error ?? patch.error ?? cancel.error} />
        {!offers.data?.length ? <Empty>No coin duels yet.</Empty> : (
          <ul className="divide-y divide-gray-100">
            {offers.data.map((o) => (
              <li key={o.id} className="py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-[220px] flex-1">
                    <p className="font-bold">{o.titleEn} <Badge tone={STATUS_TONE[o.status]}>{o.status}</Badge></p>
                    <p className="text-xs text-gray-500">
                      Entry <b>{o.entryCoins}</b> · Prize <b>{o.prizeCoins}</b> · Fee {o.feeCoins} · {o.questionCount} questions × {o.secondsPerQuestion}s{o.examName ? ` · ${o.examName.en}` : ''} · {describe(o)}
                    </p>
                  </div>
                  <div className="text-xs text-gray-600">
                    <span className="mr-3">{o.openRooms} open</span><span className="mr-3">{o.waitingRooms} waiting</span><span className="mr-3">{o.playingRooms} playing</span><span className="mr-3">{o.finishedRooms} done</span>
                    <span>{o.escrowCoins} held · {o.feesCoins} fees</span>
                  </div>
                  {can('tournament.write') && (
                    <div className="flex flex-wrap gap-1">
                      {o.status !== 'LIVE' && o.status !== 'CLOSED' && <Button size="sm" onClick={() => patch.mutate({ id: o.id, body: { status: 'LIVE' } })}>Go live</Button>}
                      {o.status === 'LIVE' && <Button size="sm" variant="secondary" onClick={() => patch.mutate({ id: o.id, body: { status: 'PAUSED' } })}>Pause</Button>}
                      {o.status !== 'CLOSED' && <Button size="sm" variant="secondary" onClick={() => patch.mutate({ id: o.id, body: { addRooms: 10 } })}>+10 rooms</Button>}
                      {o.status !== 'CLOSED' && <Button size="sm" variant="danger" onClick={() => { if (confirm('Close this duel? Waiting players are refunded; duels in play finish normally.')) patch.mutate({ id: o.id, body: { status: 'CLOSED' } }); }}>Close</Button>}
                      <Button size="sm" variant="ghost" onClick={() => setOpen(open === o.id ? null : o.id)}>{open === o.id ? 'Hide rooms' : 'Rooms'}</Button>
                    </div>
                  )}
                </div>
                {open === o.id && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {o.rooms.map((r) => (
                      <div key={r.id} className="rounded-xl border border-gray-100 p-2 text-xs">
                        <div className="flex items-center justify-between"><b>Room {r.seq}</b><Badge tone={ROOM_TONE[r.status] ?? 'gray'}>{r.status}</Badge></div>
                        <p className="mt-1 text-gray-600">{r.playerA ?? '—'} vs {r.playerB ?? '—'}</p>
                        {r.winner && <p className="text-emerald-700">Winner: {r.winner}</p>}
                        {['OPEN', 'WAITING', 'MATCHED', 'ACTIVE'].includes(r.status) && r.status !== 'OPEN' && can('tournament.write') && (
                          <button className="mt-1 font-semibold text-red-600" onClick={() => { if (confirm('Cancel this room and refund both players?')) cancel.mutate(r.id); }}>Cancel &amp; refund</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {creating && <CreateModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function describe(o: AdminPaidDuelOfferDto) {
  const e = o.eligibility;
  if (e.audience?.length === 1) return e.audience[0] === 'SCHOOL' ? (e.classLevels?.length ? `Class ${e.classLevels.join(', ')}` : 'School students') : e.examIds?.length ? 'Selected exams' : 'Exam aspirants';
  return 'Everyone';
}

function CreateModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: tax } = useTaxonomy();
  const [f, setF] = useState({ titleEn: '', titleHi: '', examId: '', entryCoins: '50', prizeCoins: '100', rooms: '20', questionCount: '5', secondsPerQuestion: '20', status: 'LIVE' as 'LIVE' | 'DRAFT' });
  const [el, setEl] = useState<EligibilityForm>({ audience: [], classLevels: [], examIds: [], minAge: '', maxAge: '' });
  const entry = Number(f.entryCoins) || 0;
  const prize = Number(f.prizeCoins) || 0;
  const m = useMutation({
    mutationFn: () => api('/v1/admin/paid-duels', { method: 'POST', json: { titleEn: f.titleEn, titleHi: f.titleHi || null, examId: f.examId || null, entryCoins: entry, prizeCoins: prize, rooms: Number(f.rooms), questionCount: Number(f.questionCount), secondsPerQuestion: Number(f.secondsPerQuestion), status: f.status, eligibility: eligibilityToApi(el) } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['paid-duels'] }); onClose(); },
  });
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  return (
    <Modal open onClose={onClose} title="Create coin duels" wide>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Title (English)"><Input value={f.titleEn} onChange={(e) => set('titleEn', e.target.value)} placeholder="Quick 1v1 — Maths" /></Field>
        <Field label="शीर्षक (Hindi, optional)"><Input value={f.titleHi} onChange={(e) => set('titleHi', e.target.value)} /></Field>
        <Field label="Entry fee (coins)"><Input type="number" min={1} value={f.entryCoins} onChange={(e) => set('entryCoins', e.target.value)} /></Field>
        <Field label="Winner’s prize (coins)" hint={`Pool is ${entry * 2}. Platform fee: ${entry * 2 - prize} coins per duel.`}>
          <Input type="number" min={0} value={f.prizeCoins} onChange={(e) => set('prizeCoins', e.target.value)} />
          <div className="mt-1 flex gap-1 text-xs">
            <button type="button" className="rounded bg-gray-100 px-2 py-1" onClick={() => set('prizeCoins', String(Math.round(entry * 1.5)))}>75% of pool</button>
            <button type="button" className="rounded bg-gray-100 px-2 py-1" onClick={() => set('prizeCoins', String(entry * 2))}>100% (no fee)</button>
          </div>
        </Field>
        <Field label="Number of duels (rooms)" hint="Each room is one 1v1 match."><Input type="number" min={1} max={200} value={f.rooms} onChange={(e) => set('rooms', e.target.value)} /></Field>
        <Field label="Questions per duel"><Input type="number" min={3} max={15} value={f.questionCount} onChange={(e) => set('questionCount', e.target.value)} /></Field>
        <Field label="Seconds per question"><Input type="number" min={5} max={90} value={f.secondsPerQuestion} onChange={(e) => set('secondsPerQuestion', e.target.value)} /></Field>
        <Field label="Question source">
          <select className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm" value={f.examId} onChange={(e) => set('examId', e.target.value)}>
            <option value="">Any exam / subject</option>
            {tax?.exams.map((e) => <option key={e.id} value={e.id}>{e.nameEn}</option>)}
          </select>
        </Field>
      </div>
      <div className="mt-4"><p className="mb-2 text-sm font-semibold">Who can join</p><AudiencePicker value={el} onChange={setEl} exams={tax?.exams ?? []} /></div>
      <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.status === 'LIVE'} onChange={(e) => setF({ ...f, status: e.target.checked ? 'LIVE' : 'DRAFT' })} /> Make them live now</label>
      <ErrorBox error={m.error} />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={f.titleEn.trim().length < 3 || entry < 1 || prize > entry * 2 || m.isPending} onClick={() => m.mutate()}>Create {f.rooms} duels</Button>
      </div>
    </Modal>
  );
}
