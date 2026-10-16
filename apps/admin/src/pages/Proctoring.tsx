import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FLAG_TYPES,
  PROCTOR_FLAG_TYPES,
  PROCTOR_MODE_INFO,
  type FlagSeverity,
  type ProctorFlagDto,
  type ProctorSessionDetailDto,
  type ProctorSessionDto,
} from '@testwise/shared';
import { Camera, CircleAlert, Eye, Mic, Monitor, Radio, ShieldBan, ShieldCheck, Smartphone, Square, TriangleAlert, Video, Wifi, WifiOff, X } from 'lucide-react';
import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { io, type Socket } from 'socket.io-client';
import { Badge, Button, Card, cx, Empty, ErrorBox, Field, fmtDate, Modal, PageHeader, Select, Textarea } from '../components/ui';
import { api, API_BASE, can, getSession } from '../lib/api';

interface Overview {
  liveConfigured: boolean;
  totals: { openFlags: number; criticalFlags: number; activeSessions: number };
  tournaments: { id: string; titleEn: string; slug: string; status: string; startsAt: string; proctorMode: string; registered: number; paidWithRewards: boolean; active: number; ended: number; openFlags: number; criticalFlags: number }[];
  tests: { id: string; titleEn: string; proctorMode: string; active: number; ended: number }[];
}

const SEV_TONE: Record<FlagSeverity, 'gray' | 'amber' | 'red' | 'violet'> = { LOW: 'gray', MEDIUM: 'amber', HIGH: 'red', CRITICAL: 'violet' };
const RISK_RING: Record<string, string> = { LOW: 'ring-emerald-300', MEDIUM: 'ring-amber-300', HIGH: 'ring-red-400', CRITICAL: 'ring-violet-500' };
const TRUST_TONE = { OK: 'green', REVIEW: 'amber', LOW: 'red' } as const;
const TRUST_RING = { OK: 'ring-emerald-300', REVIEW: 'ring-amber-300', LOW: 'ring-red-500' } as const;

const WARN_PRESETS = ['Keep your face in the camera frame.', 'Please stay silent during the test.', 'Remove anyone else from the room.', 'Do not leave the test app.', 'Remove your earphones.'];

/** One /proctor socket per page; patches cached sessions as events arrive. */
function useProctorSocket(scope: string, onFlag: (f: ProctorFlagDto) => void) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const flagRef = useRef(onFlag);
  flagRef.current = onFlag;
  useEffect(() => {
    const s: Socket = io(`${API_BASE}/proctor`, { auth: { token: getSession()?.accessToken, admin: true }, transports: ['websocket'] });
    s.on('connect', () => {
      setConnected(true);
      s.emit('watch', { scope });
    });
    s.on('disconnect', () => setConnected(false));
    const patch = (sessionId: string, p: Partial<ProctorSessionDto>) => {
      qc.setQueriesData<ProctorSessionDto[]>({ queryKey: ['proctor-sessions'] }, (old) => old?.map((x) => (x.id === sessionId ? { ...x, ...p } : x)));
      qc.setQueryData<ProctorSessionDetailDto>(['proctor-session', sessionId], (old) => (old ? { ...old, ...p } : old));
    };
    s.on('session:update', (u: { sessionId: string } & Record<string, unknown>) => {
      const { sessionId, ...rest } = u;
      patch(sessionId, rest as Partial<ProctorSessionDto>);
    });
    s.on('session:snapshot', (u: { sessionId: string; url: string; faces: number | null; at: string }) => patch(u.sessionId, { snapshotUrl: u.url, faces: u.faces, snapshotAt: u.at }));
    s.on('flag:new', (f: ProctorFlagDto) => {
      flagRef.current(f);
      void qc.invalidateQueries({ queryKey: ['proctor-flags'] });
      void qc.invalidateQueries({ queryKey: ['proctor-session', f.sessionId] });
      void qc.invalidateQueries({ queryKey: ['proctor-overview'] });
    });
    s.on('action:new', (a: { sessionId: string }) => void qc.invalidateQueries({ queryKey: ['proctor-session', a.sessionId] }));
    return () => {
      s.close();
    };
  }, [scope, qc]);
  return connected;
}

export function ProctoringPage() {
  const [tab, setTab] = useState<'live' | 'flags' | 'bans'>('live');
  const [scope, setScope] = useState('all');
  const [open, setOpen] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ProctorFlagDto[]>([]);
  const overview = useQuery({ queryKey: ['proctor-overview'], queryFn: () => api<Overview>('/v1/admin/proctor/overview'), refetchInterval: 30_000 });
  const connected = useProctorSocket(scope, (f) => {
    if (f.severity === 'CRITICAL' || f.severity === 'HIGH') setToasts((t) => [f, ...t].slice(0, 4));
  });
  const o = overview.data;
  // Start on the exam that is running instead of a mixed list of every student; the admin can still pick "All exams".
  const pickedRef = useRef(false);
  useEffect(() => {
    if (pickedRef.current || !o) return;
    const live = o.tournaments.find((t) => t.active > 0) ?? o.tournaments.find((t) => t.status === 'LIVE');
    if (live) setScope(live.id);
    pickedRef.current = true;
  }, [o]);

  return (
    <>
      <PageHeader
        title="Proctoring"
        subtitle="Live monitoring of proctored tests. The system flags suspicious activity with proof and warns students automatically; blocking an account is always your decision."
        actions={
          <>
            <Badge tone={connected ? 'green' : 'red'}>{connected ? <><Wifi size={12} className="inline" /> live</> : <><WifiOff size={12} className="inline" /> offline</>}</Badge>
            <Link to="/settings#proctoring.policy"><Button variant="secondary">Rules & thresholds</Button></Link>
          </>
        }
      />
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          ['Active sessions', o?.totals.activeSessions],
          ['Open flags', o?.totals.openFlags],
          ['Critical (open)', o?.totals.criticalFlags],
          ['Live video', o ? (o.liveConfigured ? 'Ready' : 'Not configured') : '—'],
        ].map(([k, v]) => (
          <Card key={k as string}><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{k}</p><p className="mt-2 text-2xl font-extrabold tabular-nums">{v ?? '—'}</p></Card>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {(['live', 'flags', 'bans'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx('rounded-xl px-4 py-2 text-sm font-semibold', tab === t ? 'bg-ink text-white' : 'bg-white text-gray-600 hover:bg-gray-100')}>
            {t === 'live' ? 'Live monitor' : t === 'bans' ? 'Banned devices' : `Flags queue${o?.totals.openFlags ? ` (${o.totals.openFlags})` : ''}`}
          </button>
        ))}
        <div className="ml-auto w-72">
          <Select value={scope} onChange={(e) => { pickedRef.current = true; setScope(e.target.value); }}>
            <option value="all">All exams (mixed)</option>
            <option value="practice">Practice tests (all)</option>
            {!!o?.tournaments.length && <optgroup label="Tournaments">
              {o.tournaments.map((t) => (
                <option key={t.id} value={t.id}>{t.titleEn} · {t.proctorMode}{t.status === 'LIVE' ? ' · LIVE' : ` · ${t.status.replace('_', ' ').toLowerCase()}`}{t.active ? ` · ${t.active} taking` : ''}</option>
              ))}
            </optgroup>}
            {!!o?.tests.length && <optgroup label="Practice tests">
              {o.tests.map((t) => (
                <option key={t.id} value={`test:${t.id}`}>{t.titleEn} · {t.proctorMode}{t.active ? ` · ${t.active} taking` : ''}</option>
              ))}
            </optgroup>}
          </Select>
        </div>
      </div>

      {tab === 'live' ? <LiveWall scope={scope} onOpen={setOpen} overview={o} /> : tab === 'bans' ? <BannedDevices /> : <FlagsQueue scope={scope} onOpen={setOpen} />}
      {open && <SessionDrawer id={open} onClose={() => setOpen(null)} liveConfigured={!!o?.liveConfigured} />}

      <div className="fixed bottom-4 right-4 z-40 flex w-80 flex-col gap-2">
        {toasts.map((f) => (
          <div key={f.id} className="rounded-xl border border-red-200 bg-white p-3 shadow-lg">
            <div className="flex items-start gap-2">
              <TriangleAlert size={16} className="mt-0.5 text-red-600" />
              <div className="flex-1">
                <p className="text-sm font-bold">{FLAG_TYPES[f.type]?.labelEn ?? f.type}</p>
                <p className="text-xs text-gray-500">{f.user?.displayName} · {f.tournament?.titleEn ?? f.testTitle ?? 'Practice'}</p>
                {typeof f.message === 'string' && f.type === 'APP_SWITCH' && <p className="text-xs font-semibold text-red-600">Left the test app — student has been warned</p>}
                <button className="mt-1 text-xs font-semibold text-brand-600" onClick={() => { setOpen(f.sessionId); setToasts((t) => t.filter((x) => x.id !== f.id)); }}>Review now</button>
              </div>
              <button onClick={() => setToasts((t) => t.filter((x) => x.id !== f.id))}><X size={14} /></button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function LiveWall({ scope, onOpen, overview }: { scope: string; onOpen: (id: string) => void; overview?: Overview }) {
  const [status, setStatus] = useState('ACTIVE');
  const [risk, setRisk] = useState('');
  const [view, setView] = useState<'wall' | 'cards'>(() => {
    try { return localStorage.getItem('tw_proctor_view') === 'cards' ? 'cards' : 'wall'; } catch { return 'wall'; }
  });
  const wallRef = useRef<HTMLDivElement>(null);
  const pickView = (v: 'wall' | 'cards') => {
    setView(v);
    try { localStorage.setItem('tw_proctor_view', v); } catch { /* optional */ }
  };
  const sessions = useQuery({
    queryKey: ['proctor-sessions', scope, status],
    queryFn: () => api<ProctorSessionDto[]>(`/v1/admin/proctor/sessions?status=${status}${scope === 'all' ? '' : scope === 'practice' ? '&practice=1' : scope.startsWith('test:') ? `&testId=${scope.slice(5)}` : `&tournamentId=${scope}`}`),
    refetchInterval: 20_000,
  });
  const rows = (sessions.data ?? []).filter((s) => !risk || s.trustBand === risk).sort((a, b) => a.trust - b.trust);
  const t = overview?.tournaments.find((x) => x.id === scope);
  const pt = scope.startsWith('test:') ? overview?.tests.find((x) => `test:${x.id}` === scope) : undefined;
  return (
    <div className="mt-4">
      {pt && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-bold">{pt.titleEn}</span>
            <Badge tone="blue">{PROCTOR_MODE_INFO[pt.proctorMode as keyof typeof PROCTOR_MODE_INFO]?.labelEn ?? pt.proctorMode}</Badge>
            <Badge tone="gray">practice test</Badge>
            <span className="text-gray-500">{pt.active} taking now · {pt.ended} finished</span>
          </div>
        </Card>
      )}
      {t && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-bold">{t.titleEn}</span>
            <Badge tone="blue">{PROCTOR_MODE_INFO[t.proctorMode as keyof typeof PROCTOR_MODE_INFO]?.labelEn ?? t.proctorMode}</Badge>
            {t.paidWithRewards && <Badge tone="amber">paid · rewards</Badge>}
            <span className="text-gray-500">{t.registered} registered · {t.active} taking now · {t.ended} finished · {t.openFlags} open flags ({t.criticalFlags} critical)</span>
          </div>
        </Card>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="w-44"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="ACTIVE">Taking now</option><option value="ENDED">Finished</option><option value="TERMINATED">Ended by proctor</option></Select></div>
        <div className="w-44"><Select value={risk} onChange={(e) => setRisk(e.target.value)}><option value="">Any trust</option><option value="LOW">Low trust</option><option value="REVIEW">Needs review</option><option value="OK">Trusted</option></Select></div>
        <div className="flex overflow-hidden rounded-xl border border-gray-200 bg-white text-sm">
          {(['wall', 'cards'] as const).map((v) => <button key={v} onClick={() => pickView(v)} className={cx('whitespace-nowrap px-3 py-2 font-semibold', view === v ? 'bg-ink text-white' : 'text-gray-600 hover:bg-gray-50')}>{v === 'wall' ? 'Wall (all on one screen)' : 'Cards'}</button>)}
        </div>
        <div className="whitespace-nowrap"><Button variant="secondary" onClick={() => void wallRef.current?.requestFullscreen?.()}>Full screen</Button></div>
        <span className="self-center text-xs text-gray-500">{rows.length} students · lowest trust first · trust is visible to admins only</span>
      </div>
      <ErrorBox error={sessions.error} />
      {!rows.length ? (
        <Empty>No {status === 'ACTIVE' ? 'students are taking a proctored test right now' : 'sessions'}.</Empty>
      ) : (
        <div ref={wallRef} className={cx(view === 'wall' && 'bg-gray-50 p-2')}>
        {view === 'wall' && (
          <>
            <div className="mb-2 flex flex-wrap gap-2 text-xs font-semibold">
              <Badge tone="red">{rows.filter((r) => r.trustBand === 'LOW').length} low trust</Badge>
              <Badge tone="amber">{rows.filter((r) => r.trustBand === 'REVIEW').length} need review</Badge>
              <Badge tone="green">{rows.filter((r) => r.trustBand === 'OK').length} trusted</Badge>
              <Badge tone="gray">{rows.filter((r) => !r.online).length} offline</Badge>
              <Badge tone="gray">{rows.filter((r) => r.appState && r.appState !== 'active').length} out of app</Badge>
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
              {rows.map((s) => (
                <button key={s.id} onClick={() => onOpen(s.id)} title={`${s.user.displayName} · trust ${s.trust} · ${s.openFlags} open flags`} className={cx('overflow-hidden rounded-xl bg-white text-left shadow-sm ring-2 transition hover:shadow-md', TRUST_RING[s.trustBand])}>
                  <div className="relative aspect-[4/3] bg-gray-900">
                    {s.snapshotUrl ? <img src={s.snapshotUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center px-1 text-center text-[10px] text-gray-400">{s.mode === 'BASIC' ? 'no camera' : 'waiting…'}</div>}
                    <span className={cx('absolute left-1 top-1 h-2 w-2 rounded-full ring-1 ring-white', s.online ? 'bg-emerald-500' : 'bg-gray-400')} />
                    {(s.live || s.features?.liveStream) && <span className="absolute right-1 top-1 rounded bg-red-600 px-1 text-[9px] font-bold text-white">LIVE</span>}
                    {s.appState && s.appState !== 'active' && <span className="absolute bottom-1 left-1 rounded bg-red-600/90 px-1 text-[9px] font-bold text-white">LEFT APP</span>}
                    {s.faces != null && s.faces !== 1 && <span className="absolute bottom-1 right-1 rounded bg-violet-600/90 px-1 text-[9px] font-bold text-white">{s.faces}👤</span>}
                  </div>
                  <div className="px-2 py-1.5">
                    <div className="flex items-center gap-1">
                      <p className="flex-1 truncate text-xs font-bold">{s.user.displayName}</p>
                      <span className={cx('text-xs font-extrabold tabular-nums', s.trustBand === 'OK' ? 'text-emerald-600' : s.trustBand === 'REVIEW' ? 'text-amber-600' : 'text-red-600')}>{s.trust}</span>
                    </div>
                    <p className="truncate text-[10px] text-gray-500">{s.answered}/{s.totalQuestions} · {s.openFlags} flags{s.leftAppCount > 0 ? ` · ×${s.leftAppCount} left` : ''}</p>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
        {view === 'cards' && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-6">
          {rows.map((s) => (
            <button key={s.id} onClick={() => onOpen(s.id)} className={cx('overflow-hidden rounded-2xl bg-white text-left shadow-sm ring-2 transition hover:shadow-md', TRUST_RING[s.trustBand])}>
              <div className="relative aspect-[4/3] bg-gray-900">
                {s.snapshotUrl ? <img src={s.snapshotUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-gray-400">{s.mode === 'BASIC' ? 'No camera (basic mode)' : 'Waiting for snapshot'}</div>}
                <span className={cx('absolute left-2 top-2 h-2.5 w-2.5 rounded-full ring-2 ring-white', s.online ? 'bg-emerald-500' : 'bg-gray-400')} />
                {(s.live || s.features?.liveStream) && <span className="absolute right-2 top-2 rounded bg-red-600 px-1.5 text-[10px] font-bold text-white">{s.live ? 'WATCHING' : 'STREAMING'}</span>}
                {s.appState && s.appState !== 'active' && <span className="absolute bottom-2 left-2 rounded bg-red-600/90 px-1.5 text-[10px] font-bold text-white">LEFT APP</span>}
                {s.faces != null && s.faces !== 1 && <span className="absolute bottom-2 right-2 rounded bg-violet-600/90 px-1.5 text-[10px] font-bold text-white">{s.faces} faces</span>}
              </div>
              <div className="p-3">
                <div className="flex items-center gap-2">
                  <p className="flex-1 truncate text-sm font-bold">{s.user.displayName}</p>
                  <Badge tone={TRUST_TONE[s.trustBand]}>Trust {s.trust}</Badge>
                </div>
                <p className="mt-1 text-xs text-gray-500">Q{(s.questionIndex ?? 0) + 1}/{s.totalQuestions} · {s.answered} answered · {s.openFlags} open flags · {s.warningCount} warnings{s.leftAppCount > 0 && <> · <span className="font-semibold text-red-600">left app ×{s.leftAppCount}</span></>}</p>
                {s.trustBand !== 'OK' && <p className="mt-1 text-[11px] font-bold text-red-600">{s.trustBand === 'LOW' ? 'LOW TRUST — review now' : 'Needs review'}</p>}
                {s.user.status !== 'ACTIVE' && <Badge tone="red">blocked</Badge>}
              </div>
            </button>
          ))}
        </div>}
        </div>
      )}
    </div>
  );
}

function Evidence({ f }: { f: ProctorFlagDto }) {
  if (!f.evidence.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {f.evidence.map((e, i) =>
        e.kind === 'image' ? (
          <a key={i} href={e.url} target="_blank" rel="noreferrer"><img src={e.url} alt="evidence" className="h-24 rounded-lg object-cover ring-1 ring-gray-200" /></a>
        ) : (
          <audio key={i} src={e.url} controls preload="none" className="h-9" />
        ),
      )}
    </div>
  );
}

function FlagRow({ f, onOpen, showUser }: { f: ProctorFlagDto; onOpen?: () => void; showUser?: boolean }) {
  const qc = useQueryClient();
  const review = useMutation({
    mutationFn: (status: 'CONFIRMED' | 'DISMISSED') => api(`/v1/admin/proctor/flags/${f.id}/review`, { method: 'POST', json: { status } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['proctor-flags'] });
      void qc.invalidateQueries({ queryKey: ['proctor-session', f.sessionId] });
      void qc.invalidateQueries({ queryKey: ['proctor-overview'] });
    },
  });
  const d = f.details as Record<string, unknown>;
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={SEV_TONE[f.severity]}>{f.severity}</Badge>
        <span className="text-sm font-bold">{FLAG_TYPES[f.type]?.labelEn ?? f.type}</span>
        <span className="text-xs text-gray-400">{f.source.toLowerCase()} · {fmtDate(f.occurredAt)}{f.confidence != null && ` · ${Math.round(f.confidence * 100)}% confidence`}</span>
        {f.status !== 'OPEN' && <Badge tone={f.status === 'CONFIRMED' ? 'red' : 'gray'}>{f.status.toLowerCase()}</Badge>}
        <span className="ml-auto flex gap-1">
          {showUser && onOpen && <Button size="sm" variant="ghost" onClick={onOpen}><Eye size={14} /> Session</Button>}
          {can('proctor.act') && f.status === 'OPEN' && (
            <>
              <Button size="sm" variant="secondary" disabled={review.isPending} onClick={() => review.mutate('DISMISSED')}>Dismiss</Button>
              <Button size="sm" variant="danger" disabled={review.isPending} onClick={() => review.mutate('CONFIRMED')}>Confirm</Button>
            </>
          )}
        </span>
      </div>
      {showUser && <p className="mt-1 text-xs text-gray-600">{f.user?.displayName} ({f.user?.email ?? '—'}) · {f.tournament?.titleEn ?? f.testTitle ?? 'Practice test'}</p>}
      <p className="mt-1 text-xs text-gray-600">
        {f.message}
        {typeof d.transcript === 'string' && <> · heard: <q className="font-semibold">{d.transcript}</q></>}
        {typeof d.faces === 'number' && <> · faces: {d.faces}</>}
        {typeof d.yaw === 'number' && <> · head turned {Math.round(d.yaw)}°</>}
        {Array.isArray(d.packages) && <> · {(d.packages as string[]).join(', ')}</>}
        {Array.isArray(d.objects) && <> · saw: {(d.objects as { label: string; confidence: number }[]).map((o) => `${o.label} ${Math.round(o.confidence * 100)}%`).join(', ')}</>}
        {Array.isArray(d.reasons) && <> · {(d.reasons as string[]).join('; ')}</>}
        {typeof d.durationSec === 'number' && <> · {Math.round(d.durationSec)}s</>}
        {typeof d.questionIndex === 'number' && <> · on Q{d.questionIndex + 1}</>}
        {typeof d.evidencePurgedAt === 'string' && <> · media deleted (retention)</>}
      </p>
      <Evidence f={f} />
    </li>
  );
}

function FlagsQueue({ scope, onOpen }: { scope: string; onOpen: (id: string) => void }) {
  const [status, setStatus] = useState('OPEN');
  const [severity, setSeverity] = useState('');
  const [type, setType] = useState('');
  const params = new URLSearchParams({ status, ...(severity && { severity }), ...(type && { type }), ...(scope.startsWith('test:') ? { testId: scope.slice(5) } : scope !== 'all' && scope !== 'practice' && { tournamentId: scope }) });
  const flags = useQuery({ queryKey: ['proctor-flags', params.toString()], queryFn: () => api<ProctorFlagDto[]>(`/v1/admin/proctor/flags?${params}`), refetchInterval: 20_000 });
  return (
    <Card className="mt-4">
      <div className="mb-2 flex flex-wrap gap-2">
        <Select className="w-36" value={status} onChange={(e) => setStatus(e.target.value)}><option>OPEN</option><option>CONFIRMED</option><option>DISMISSED</option></Select>
        <Select className="w-44" value={severity} onChange={(e) => setSeverity(e.target.value)}><option value="">All severities</option><option value="CRITICAL">Critical</option><option value="HIGH,CRITICAL">High + critical</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option></Select>
        <Select className="w-56" value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option>{PROCTOR_FLAG_TYPES.map((t) => <option key={t} value={t}>{FLAG_TYPES[t].labelEn}</option>)}</Select>
      </div>
      <ErrorBox error={flags.error} />
      {!flags.data?.length ? <Empty>No flags match.</Empty> : <ul className="divide-y divide-gray-100">{flags.data.map((f) => <FlagRow key={f.id} f={f} showUser onOpen={() => onOpen(f.sessionId)} />)}</ul>}
    </Card>
  );
}

/** Subscribes to the student's camera + mic over LiveKit. */
function LiveVideo({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const screenRef = useRef<HTMLVideoElement>(null);
  const [hasScreen, setHasScreen] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [state, setState] = useState('Requesting the student’s camera…');
  const [error, setError] = useState<unknown>(null);
  const [captured, setCaptured] = useState(false);
  const qc = useQueryClient();
  useEffect(() => {
    const room = new Room({ adaptiveStream: true });
    let cancelled = false;
    (async () => {
      try {
        const t = await api<{ url: string; token: string }>(`/v1/admin/proctor/sessions/${sessionId}/live`, { method: 'POST' });
        room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          if (track.kind === Track.Kind.Video && track.source === Track.Source.ScreenShare) {
            if (screenRef.current) track.attach(screenRef.current);
            setHasScreen(true);
          } else if (track.kind === Track.Kind.Video && videoRef.current) track.attach(videoRef.current);
          if (track.kind === Track.Kind.Audio && audioRef.current) track.attach(audioRef.current);
          setState('Live');
        });
        room.on(RoomEvent.ParticipantDisconnected, () => setState('Student disconnected — waiting…'));
        await room.connect(t.url, t.token);
        if (!cancelled) setState('Connected — waiting for the student’s phone to start streaming…');
      } catch (e) {
        setError(e);
      }
    })();
    return () => {
      cancelled = true;
      void room.disconnect();
      void api(`/v1/admin/proctor/sessions/${sessionId}/live/stop`, { method: 'POST' }).catch(() => undefined);
    };
  }, [sessionId]);

  async function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.85));
    if (!blob) return;
    const fd = new FormData();
    fd.append('image', blob, 'capture.jpg');
    fd.append('message', 'Captured from live view');
    await api(`/v1/admin/proctor/sessions/${sessionId}/evidence`, { method: 'POST', body: fd });
    setCaptured(true);
    setTimeout(() => setCaptured(false), 2000);
    void qc.invalidateQueries({ queryKey: ['proctor-session', sessionId] });
  }

  return (
    <div className="rounded-2xl bg-gray-900 p-2">
      <div className={cx('grid gap-2', hasScreen && 'sm:grid-cols-2')}>
        <div><p className="mb-1 text-[11px] font-semibold uppercase text-gray-400">Camera</p><video ref={videoRef} autoPlay playsInline muted className="aspect-video w-full rounded-xl bg-black object-contain" /></div>
        <div className={hasScreen ? '' : 'hidden'}><p className="mb-1 text-[11px] font-semibold uppercase text-gray-400">Screen</p><video ref={screenRef} autoPlay playsInline muted className="aspect-video w-full rounded-xl bg-black object-contain" /></div>
      </div>
      <audio ref={audioRef} autoPlay />
      <div className="mt-2 flex items-center gap-2 text-xs text-gray-300">
        <Radio size={14} className={state === 'Live' ? 'text-red-500' : ''} /> {state}
        <span className="ml-auto flex gap-2">
          {can('proctor.act') && <Button size="sm" variant="secondary" onClick={capture}><Camera size={14} /> {captured ? 'Saved as evidence' : 'Capture evidence'}</Button>}
          <Button size="sm" variant="secondary" onClick={onClose}><Square size={14} /> Stop</Button>
        </span>
      </div>
      <ErrorBox error={error} />
      <p className="mt-1 text-[11px] text-gray-500">Your viewing is logged. The student sees a “proctor is watching” indicator.</p>
    </div>
  );
}

function SessionDrawer({ id, onClose, liveConfigured }: { id: string; onClose: () => void; liveConfigured: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['proctor-session', id], queryFn: () => api<ProctorSessionDetailDto>(`/v1/admin/proctor/sessions/${id}`), refetchInterval: 15_000 });
  const [live, setLive] = useState(false);
  const [dialog, setDialog] = useState<null | 'warn' | 'terminate' | 'block' | 'note' | 'disqualify' | 'ban-device' | 'reinstate'>(null);
  const s = q.data;
  const integrity = s?.integrity ?? {};
  const issues = useMemo(() => {
    const out: string[] = [];
    if (integrity.rooted) out.push('Rooted / jailbroken');
    if (integrity.emulator) out.push('Emulator');
    if (integrity.usbDebugging) out.push('USB debugging on');
    if (integrity.screenCaptured) out.push('Screen being captured');
    if ((integrity.externalDisplays ?? 0) > 0) out.push('External display');
    if (integrity.headphones) out.push('Headphones connected');
    if (integrity.multiWindow) out.push('Split screen');
    if (integrity.accessibilityServices?.length) out.push(`Accessibility: ${integrity.accessibilityServices.join(', ')}`);
    if (integrity.remoteApps?.length) out.push(`Remote apps: ${integrity.remoteApps.map((r) => r.name).join(', ')}`);
    if (integrity.nativeChecks === false) out.push('Device checks unavailable on this build');
    return out;
  }, [integrity]);

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-6xl overflow-y-auto bg-gray-50 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start gap-3">
          <div className="flex-1">
            <h2 className="text-xl font-extrabold">{s?.user.displayName ?? '…'}</h2>
            <p className="text-sm text-gray-500">{s?.user.email} · {s?.tournament?.titleEn ?? 'Practice test'} · {s && PROCTOR_MODE_INFO[s.mode].labelEn} · consent v{s?.consentVersion} at {fmtDate(s?.consentAt)}</p>
          </div>
          {s && <Badge tone={s.risk === 'LOW' ? 'green' : s.risk === 'MEDIUM' ? 'amber' : s.risk === 'HIGH' ? 'red' : 'violet'}>Risk {s.riskScore} · {s.risk}</Badge>}
          {s && <Badge tone={s.status === 'ACTIVE' ? 'blue' : s.status === 'TERMINATED' ? 'red' : 'gray'}>{s.status}</Badge>}
          <button onClick={onClose}><X /></button>
        </div>
        <ErrorBox error={q.error} />
        {s && (
          <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
            <div className="space-y-4">
              <Card title={<span className="flex items-center gap-2"><Video size={16} /> Camera & voice</span>}>
                {live ? (
                  <LiveVideo sessionId={s.id} onClose={() => setLive(false)} />
                ) : (
                  <div className="relative">
                    {s.snapshotUrl ? <img src={s.snapshotUrl} alt="latest snapshot" className="aspect-video w-full rounded-xl bg-black object-contain" /> : <div className="flex aspect-video items-center justify-center rounded-xl bg-gray-900 text-sm text-gray-400">No snapshot yet</div>}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      Latest snapshot {fmtDate(s.snapshotAt)} · faces: {s.faces ?? '—'}
                      <span className="ml-auto">
                        {s.mode === 'LIVE' && s.status === 'ACTIVE' ? (
                          <Button size="sm" disabled={!liveConfigured} onClick={() => setLive(true)} title={liveConfigured ? '' : 'Set LIVEKIT_URL / API key / secret on the server'}><Radio size={14} /> Watch & listen live</Button>
                        ) : (
                          <span>Live video needs LIVE mode on an active attempt</span>
                        )}
                      </span>
                    </div>
                  </div>
                )}
              </Card>

              <Card title={<span className="flex items-center gap-2"><Monitor size={16} /> Screen mirror</span>}>
                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <Stat label="App" value={!s.online ? 'Offline' : s.appState === 'active' ? 'In test' : s.appState ? `Left app (${s.appState})` : 'Connecting…'} bad={!s.online || (!!s.appState && s.appState !== 'active')} />
                  <Stat label="Question" value={`${(s.questionIndex ?? 0) + 1} / ${s.totalQuestions}`} />
                  <Stat label="Answered" value={`${s.answered}`} />
                  <Stat label="Last seen" value={s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleTimeString() : '—'} />
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100"><div className="h-full bg-brand-500" style={{ width: `${s.totalQuestions ? (s.answered / s.totalQuestions) * 100 : 0}%` }} /></div>
                <p className="mt-2 text-xs text-gray-500">{s.features?.screenShare ? 'This exam uses screen sharing: open the live view above to watch the student’s screen. ' : 'The test screen is protected from screenshots and recording, so instead of pixels the app reports what the student is doing: current question, answers, and whether the test is in front. '}Deadline {fmtDate(s.deadlineAt)}.</p>
              </Card>

              <Card title={<span className="flex items-center gap-2"><ShieldCheck size={16} /> Trust score <span className="text-xs font-normal text-gray-400">(admins only — never shown to the student)</span></span>}>
                <div className="flex items-end gap-3">
                  <p className={cx('text-4xl font-extrabold tabular-nums', s.trustBand === 'OK' ? 'text-emerald-600' : s.trustBand === 'REVIEW' ? 'text-amber-600' : 'text-red-600')}>{s.trust}</p>
                  <p className="pb-1 text-sm text-gray-500">/ 100 · {s.trustBand === 'OK' ? 'no action needed' : s.trustBand === 'REVIEW' ? 'needs review' : 'low trust — review now'} · left the app ×{s.leftAppCount}</p>
                </div>
                <ul className="mt-3 space-y-1 text-xs text-gray-600">
                  {Object.entries(s.flags.filter((x) => x.status !== 'DISMISSED' && x.source !== 'ADMIN').reduce<Record<string, number>>((m, x) => ({ ...m, [x.type]: (m[x.type] ?? 0) + 1 }), {})).map(([t, n]) => (
                    <li key={t}>{FLAG_TYPES[t as keyof typeof FLAG_TYPES]?.labelEn ?? t} ×{n}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-gray-500">Starts at 100 and drops with each flag. Dismissing a false alarm restores it. Only repeated app switching and repeated extra faces can submit a test automatically; every other flag waits for your decision.</p>
              </Card>

              <Card title={<span className="flex items-center gap-2"><Smartphone size={16} /> Device</span>}>
                <p className="text-sm">{s.device?.brand} {s.device?.model} · {s.device?.osName} {s.device?.osVersion} · app {s.device?.appVersion ?? '—'}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {s.attestation ? (
                    <Badge tone={s.attestation.ok ? 'green' : 'red'}>{s.attestation.platform === 'ios' ? 'App Attest' : 'Play Integrity'}: {s.attestation.ok ? s.attestation.level.toLowerCase() : s.attestation.reasons.join(', ') || 'failed'}</Badge>
                  ) : <Badge tone="amber">No platform attestation</Badge>}
                  {s.attestedAt && <span className="text-gray-500">verified {new Date(s.attestedAt).toLocaleTimeString()}</span>}
                  {s.network && <Badge tone={s.network.rttMs > 500 ? 'amber' : 'gray'}>{Math.round(s.network.rttMs)} ms · {s.network.downMbps.toFixed(1)} Mbps at start</Badge>}
                </div>
                {s.features && <p className="mt-2 text-xs text-gray-500">Checks on: {Object.entries(s.features).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}</p>}
                {s.consent && (
                  <details className="mt-2 text-xs text-gray-600">
                    <summary className="cursor-pointer font-semibold">Consent record · {new Date(s.consent.at).toLocaleString()}</summary>
                    <p className="mt-1">Camera {s.consent.camera ? 'allowed' : 'not needed'} · Microphone {s.consent.microphone ? 'allowed' : 'not needed'} · Screen {s.consent.screen ? 'allowed' : 'not needed'} · terms {s.consent.textVersion}</p>
                    <ul className="mt-1 list-disc pl-4">{s.consent.purposes.map((p) => <li key={p}>{p}</li>)}</ul>
                  </details>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  {issues.length ? issues.map((i) => <Badge key={i} tone="red">{i}</Badge>) : <Badge tone="green"><ShieldCheck size={12} className="inline" /> No device issues reported</Badge>}
                </div>
              </Card>

              {s.snapshots.length > 0 && (
                <Card title="Snapshot timeline">
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {s.snapshots.map((x) => (
                      <a key={x.takenAt} href={x.url} target="_blank" rel="noreferrer" className="shrink-0 text-center">
                        <img src={x.url} alt="" className={cx('h-20 w-28 rounded-lg object-cover ring-2', x.faces === 1 ? 'ring-transparent' : 'ring-violet-500')} />
                        <span className="text-[10px] text-gray-500">{new Date(x.takenAt).toLocaleTimeString()} · {x.faces ?? '?'}👤</span>
                      </a>
                    ))}
                  </div>
                </Card>
              )}
            </div>

            <div className="space-y-4">
              {can('proctor.act') && (
                <Card title="Actions">
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="secondary" disabled={s.status !== 'ACTIVE'} onClick={() => setDialog('warn')}><CircleAlert size={14} /> Send warning</Button>
                    <Button variant="secondary" onClick={() => setDialog('note')}><Mic size={14} /> Add observation</Button>
                    <Button variant="danger" disabled={s.status !== 'ACTIVE'} onClick={() => setDialog('terminate')}><Square size={14} /> End test</Button>
                    <Button variant="danger" disabled={s.user.status !== 'ACTIVE'} onClick={() => setDialog('block')}><ShieldBan size={14} /> Block account</Button>
                    <Button variant="primary" disabled={s.status === 'ACTIVE'} onClick={() => setDialog('reinstate')}><Radio size={14} /> Reinstate attempt</Button>
                    <Button variant="danger" disabled={!s.tournament} onClick={() => setDialog('disqualify')}><CircleAlert size={14} /> Disqualify</Button>
                    <Button variant="danger" onClick={() => setDialog('ban-device')}><Smartphone size={14} /> Ban device</Button>
                    <Button variant="secondary" onClick={() => void api(`/v1/admin/proctor/sessions/${s.id}/analyse`, { method: 'POST' }).then(() => qc.invalidateQueries({ queryKey: ['proctor-session', id] }))}><ShieldCheck size={14} /> Re-run answer analysis</Button>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">Disqualify removes the student from the ranking and rewards (applied at once while results are in review, otherwise when they are first generated). Ban device blocks this phone from proctored tests until lifted. Nothing here is automatic; every action is audited.</p>
                </Card>
              )}
              <Card title={`Flags (${s.flags.length})`}>
                {!s.flags.length ? <Empty>No flags.</Empty> : <ul className="divide-y divide-gray-100">{s.flags.map((f) => <FlagRow key={f.id} f={f} />)}</ul>}
              </Card>
              <Card title="Warnings & actions">
                {!s.actions.length ? <Empty>None yet.</Empty> : (
                  <ul className="space-y-2 text-xs">
                    {s.actions.map((a) => (
                      <li key={a.id} className="flex gap-2">
                        <Badge tone={a.type === 'BLOCK' || a.type === 'TERMINATE' ? 'red' : a.type === 'WARN' ? 'amber' : 'gray'}>{a.type}</Badge>
                        <span className="flex-1">{a.message ?? ''} <span className="text-gray-400">· {a.actor === 'SYSTEM' ? 'automatic' : a.adminName ?? 'admin'} · {fmtDate(a.createdAt)}</span></span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        )}
        {dialog && s && <ActionDialog kind={dialog} session={s} onClose={() => { setDialog(null); void qc.invalidateQueries({ queryKey: ['proctor-session', id] }); void qc.invalidateQueries({ queryKey: ['proctor-sessions'] }); }} />}
      </div>
    </div>
  );
}

function Stat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className={cx('rounded-xl p-3', bad ? 'bg-red-50 text-red-700' : 'bg-gray-50')}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 font-bold">{value}</p>
    </div>
  );
}

function ActionDialog({ kind, session, onClose }: { kind: 'warn' | 'terminate' | 'block' | 'note' | 'disqualify' | 'ban-device' | 'reinstate'; session: ProctorSessionDetailDto; onClose: () => void }) {
  const [text, setText] = useState(kind === 'warn' ? WARN_PRESETS[0] : '');
  const [severity, setSeverity] = useState<FlagSeverity>('HIGH');
  const [minutes, setMinutes] = useState('');
  const m = useMutation({
    mutationFn: () => {
      if (kind === 'reinstate') return api(`/v1/admin/proctor/attempts/${session.attemptId}/reinstate`, { method: 'POST', json: { reason: text, ...(minutes && { minutes: Number(minutes) }) } });
      const base = `/v1/admin/proctor/sessions/${session.id}`;
      if (kind === 'warn') return api(`${base}/warn`, { method: 'POST', json: { message: text } });
      if (kind === 'note') return api(`${base}/flags`, { method: 'POST', json: { type: 'ADMIN_NOTE', message: text, severity } });
      return api(`${base}/${kind}`, { method: 'POST', json: { reason: text } });
    },
    onSuccess: onClose,
  });
  const title = { warn: 'Send a warning', terminate: 'End this test now', block: 'Block this account', note: 'Add an observation', disqualify: 'Disqualify from results', 'ban-device': 'Ban this device', reinstate: 'Reinstate this attempt' }[kind];
  return (
    <Modal open onClose={onClose} title={title}>
      {kind === 'warn' && (
        <div className="mb-3 flex flex-wrap gap-1">
          {WARN_PRESETS.map((p) => <button key={p} className="rounded-lg bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200" onClick={() => setText(p)}>{p}</button>)}
        </div>
      )}
      <Field label={kind === 'warn' ? 'Message shown to the student (and pushed)' : kind === 'note' ? 'What did you observe?' : 'Reason (shown to the student and kept in the audit log)'}>
        <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      {kind === 'note' && (
        <Field label="Severity" className="mt-3"><Select value={severity} onChange={(e) => setSeverity(e.target.value as FlagSeverity)}>{['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((x) => <option key={x}>{x}</option>)}</Select></Field>
      )}
      {kind === 'terminate' && <p className="mt-2 text-sm text-gray-600">Saved answers are submitted and scored. The student is told why and can appeal.</p>}
      {kind === 'reinstate' && (
        <>
          <Field label="Minutes to give (blank = the time that was left when it was submitted)" className="mt-3"><input className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" type="number" min={1} max={240} value={minutes} onChange={(e) => setMinutes(e.target.value)} /></Field>
          <p className="mt-2 text-sm text-gray-600">Reopens the test with the saved answers so {session.user.displayName} can continue. The old score is discarded and recalculated on the next submit; the automatic-submit count starts again. Tournament attempts can only be reinstated while the tournament is live. Students have no way to ask for this in the app except by contacting support.</p>
        </>
      )}
      {kind === 'disqualify' && <p className="mt-2 text-sm text-red-700">Removes {session.user.displayName} from the ranking and rewards for this tournament. The student is told why and can appeal. Reinstate from Tournaments → Results.</p>}
      {kind === 'ban-device' && <p className="mt-2 text-sm text-red-700">This phone (and its App Attest key) can no longer start proctored tests, even on a new account. Lift it under Proctoring → Banned devices.</p>}
      {kind === 'block' && <p className="mt-2 text-sm text-red-700">Suspends {session.user.displayName}’s account, ends any test in progress and signs them out everywhere. Reinstate from Students.</p>}
      <ErrorBox error={m.error} />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant={kind === 'terminate' || kind === 'block' || kind === 'disqualify' || kind === 'ban-device' ? 'danger' : 'primary'} disabled={text.trim().length < 3 || m.isPending} onClick={() => m.mutate()}>{title}</Button>
      </div>
    </Modal>
  );
}


interface BannedDevice { id: string; userId: string | null; reason: string; createdAt: string; sessionId: string | null }

/** Devices barred from proctored tests by a proctor. Only a hashed identifier is kept, never the raw one. */
function BannedDevices() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['proctor-bans'], queryFn: () => api<BannedDevice[]>('/v1/admin/proctor/banned-devices') });
  const lift = useMutation({
    mutationFn: (id: string) => api(`/v1/admin/proctor/banned-devices/${id}/lift`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proctor-bans'] }),
  });
  return (
    <Card title="Banned devices" className="mt-4">
      <ErrorBox error={list.error ?? lift.error} />
      {!list.data?.length ? <Empty>No banned devices.</Empty> : (
        <ul className="divide-y divide-gray-100">
          {list.data.map((b) => (
            <li key={b.id} className="flex items-center gap-3 py-3 text-sm">
              <Smartphone size={16} className="text-gray-400" />
              <div className="flex-1">
                <p className="font-semibold">{b.reason}</p>
                <p className="text-xs text-gray-500">{fmtDate(b.createdAt)}{b.sessionId ? ' · from a proctoring session' : ''}</p>
              </div>
              {can('proctor.act') && <Button variant="secondary" disabled={lift.isPending} onClick={() => lift.mutate(b.id)}>Lift ban</Button>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
