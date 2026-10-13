import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Badge, Button, Card, Empty, ErrorBox, Field, fmtDate, Input, Modal, PageHeader, Table, Toggle } from '../components/ui';
import { api, can } from '../lib/api';
import { PaidDuelsPanel } from './PaidDuels';

interface Persona { id: string; name: string; city: string | null; color: string; ratingMin: number; ratingMax: number; active: boolean; _count: { duels: number } }
interface DuelRow { id: string; mode: string; status: string; scoreA: number; scoreB: number; winner: string | null; isBot: boolean; createdAt: string; playerA: { displayName: string; email: string | null } | null; playerB: { displayName: string; email: string | null } | null; botPersona: { name: string } | null; ratingABefore: number | null; ratingAAfter: number | null }

export function DuelsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<Persona> | null>(null);
  const [tab, setTab] = useState<'free' | 'coin'>('coin');
  const stats = useQuery({ queryKey: ['duel-stats'], queryFn: () => api<{ duelsLast24h: number; activeNow: number; botShareLast24h: number; humanWinRateVsBots: number; totalFinished: number; players: number }>('/v1/admin/duels/stats'), refetchInterval: 10_000 });
  const duels = useQuery({ queryKey: ['duels'], queryFn: () => api<DuelRow[]>('/v1/admin/duels'), refetchInterval: 10_000 });
  const bots = useQuery({ queryKey: ['bots'], queryFn: () => api<Persona[]>('/v1/admin/duels/bots') });
  const del = useMutation({ mutationFn: (id: string) => api(`/v1/admin/duels/bots/${id}`, { method: 'DELETE' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['bots'] }) });
  const s = stats.data;
  return (
    <>
      <PageHeader
        title="Duels & bots"
        subtitle="Create coin duels (entry fee, coin prize, escrowed and settled by the server) and run free 1v1 duels with live matchmaking. Bots fill in only for free, no-reward duels; they never play coin duels."
        actions={<><Link to="/settings#duels.paid"><Button variant="secondary">Coin duel rules</Button></Link><Link to="/settings#duels.settings"><Button variant="secondary">Duel rules</Button></Link><Link to="/settings#duels.bots"><Button variant="secondary">Bot behaviour</Button></Link></>}
      />
      <div className="mt-2 flex gap-2">
        {([['coin', 'Coin duels'], ['free', 'Free duels & bots']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-xl px-4 py-2 text-sm font-semibold ${tab === k ? 'bg-ink text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>{l}</button>
        ))}
      </div>
      {tab === 'coin' && <PaidDuelsPanel />}
      {tab === 'free' && <>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ['Duels (24 h)', s?.duelsLast24h], ['Live now', s?.activeNow], ['Bot share (24 h)', s ? `${s.botShareLast24h}%` : '—'],
          ['Human win rate vs bots', s ? `${s.humanWinRateVsBots}%` : '—'], ['Finished duels', s?.totalFinished], ['Players', s?.players],
        ].map(([k, v]) => (
          <Card key={k as string}><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{k}</p><p className="mt-2 text-2xl font-extrabold tabular-nums">{v ?? '—'}</p></Card>
        ))}
      </div>
      <p className="mt-2 text-xs text-gray-500">A high bot share means few students are online at once; a human win rate far from ~50% means bot accuracy needs tuning.</p>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_420px]">
        <Card title="Recent duels">
          {!duels.data?.length ? <Empty>No duels yet.</Empty> : (
            <Table head={['When', 'Player A', 'Player B', 'Score', 'Mode', 'Status']}>
              {duels.data.map((d) => (
                <tr key={d.id}>
                  <td className="px-3 py-2 text-xs text-gray-500">{fmtDate(d.createdAt)}</td>
                  <td className="px-3 py-2 text-xs">{d.playerA?.displayName}{d.ratingABefore != null && d.ratingAAfter != null && <span className="ml-1 text-gray-400">{d.ratingABefore}→{d.ratingAAfter}</span>}</td>
                  <td className="px-3 py-2 text-xs">{d.isBot ? <>{d.botPersona?.name} <Badge tone="violet">bot</Badge></> : d.playerB?.displayName ?? '—'}</td>
                  <td className="px-3 py-2 text-sm tabular-nums">{d.scoreA} – {d.scoreB}</td>
                  <td className="px-3 py-2 text-xs">{d.mode}</td>
                  <td className="px-3 py-2"><Badge tone={d.status === 'FINISHED' ? 'green' : d.status === 'ACTIVE' ? 'blue' : 'gray'}>{d.status}</Badge></td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card title="Bot personas" actions={can('config.write') && <Button size="sm" onClick={() => setEditing({ color: '#8B5CF6', ratingMin: 1000, ratingMax: 1400, active: true })}><Plus size={14} /> Persona</Button>}>
          <p className="mb-3 text-xs text-gray-500">Names and rating ranges bots use. Students see them as normal opponents (disclosed in the FAQ).</p>
          <ErrorBox error={del.error} />
          <ul className="divide-y divide-gray-50">
            {bots.data?.map((b) => (
              <li key={b.id} className={`flex items-center gap-3 py-2 ${b.active ? '' : 'opacity-40'}`}>
                <span className="h-8 w-8 shrink-0 rounded-full border-4" style={{ borderColor: b.color }} />
                <div className="flex-1"><p className="text-sm font-semibold">{b.name}</p><p className="text-xs text-gray-400">{b.city ?? '—'} · {b.ratingMin}–{b.ratingMax} · {b._count.duels} duels</p></div>
                {can('config.write') && <><button onClick={() => setEditing(b)} className="p-1 text-gray-400 hover:text-ink" aria-label="Edit"><Pencil size={14} /></button><button onClick={() => window.confirm(`Remove ${b.name}? (Deactivated if already used.)`) && del.mutate(b.id)} className="p-1 text-gray-400 hover:text-red-600" aria-label="Delete"><Trash2 size={14} /></button></>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
      </>}
      {editing && <PersonaForm initial={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function PersonaForm({ initial, onClose }: { initial: Partial<Persona>; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: initial.name ?? '', city: initial.city ?? '', color: initial.color ?? '#8B5CF6', ratingMin: initial.ratingMin ?? 1000, ratingMax: initial.ratingMax ?? 1400, active: initial.active ?? true });
  const save = useMutation({
    mutationFn: () => (initial.id ? api(`/v1/admin/duels/bots/${initial.id}`, { method: 'PUT', json: { ...f, city: f.city || null } }) : api('/v1/admin/duels/bots', { method: 'POST', json: { ...f, city: f.city || null } })),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['bots'] }); onClose(); },
  });
  return (
    <Modal open onClose={onClose} title={initial.id ? 'Edit persona' : 'New persona'}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="City"><Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
        <Field label="Rating from"><Input type="number" value={f.ratingMin} onChange={(e) => setF({ ...f, ratingMin: Number(e.target.value) })} /></Field>
        <Field label="Rating to"><Input type="number" value={f.ratingMax} onChange={(e) => setF({ ...f, ratingMax: Number(e.target.value) })} /></Field>
        <Field label="Avatar ring colour"><Input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className="h-10 p-1" /></Field>
        <div className="flex items-end pb-2"><Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Active" /></div>
      </div>
      <div className="mt-4"><ErrorBox error={save.error} /></div>
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} disabled={save.isPending || f.name.length < 2}>Save</Button></div>
    </Modal>
  );
}
