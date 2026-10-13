import { AudiencePicker, eligibilityFromApi, eligibilityToApi, type EligibilityForm } from '../components/AudiencePicker';
import { ProctorOptionsEditor } from '../components/ProctorOptions';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatRupees,
  prizePoolFromTiers,
  TOURNAMENT_TRANSITIONS,
  tournamentSchema,
  winnerCountFromTiers,
  type PrizeTier,
  type TournamentStatus,
  PROCTOR_MODE_INFO,
  type ProctorOptions,
  type ProctorMode,
} from '@testwise/shared';
import { ArrowLeft, Copy, Plus, Trash2, Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  Badge, Button, Card, ErrorBox, Field, fmtDate, fromLocalInput, Input, Modal, PageHeader, Select, statusTone, Textarea, Toggle, toLocalInput,
} from '../components/ui';
import { api, ApiError, can } from '../lib/api';
import { useTaxonomy } from '../lib/hooks';

type Form = {
  slug: string; titleEn: string; titleHi: string; descriptionEn: string; descriptionHi: string;
  rulesEn: string; rulesHi: string; scoringEn: string; scoringHi: string; refundPolicyEn: string; refundPolicyHi: string;
  examId: string; subjectId: string; testId: string; format: 'MASS' | 'KNOCKOUT' | 'LEAGUE' | 'DUEL'; entryMode: 'FREE' | 'PAID';
  entryFeeRupees: string; platformFeePercent: string;
  rewardType: 'NONE' | 'CASH' | 'VOUCHER' | 'SCHOLARSHIP' | 'MERCHANDISE' | 'MIXED'; fundingSource: 'PLATFORM' | 'SPONSOR' | 'ENTRY_FEES';
  sponsorName: string; prizeTiers: PrizeTier[]; maxParticipants: string; minParticipants: string;
  registrationOpensAt: string; registrationClosesAt: string; startsAt: string; endsAt: string;
  durationMinutes: string; questionCount: string;
  eligibility: EligibilityForm & { requiresVerifiedEmail: boolean };
  bannerColor: string; featured: boolean; proctorMode: ProctorMode; proctorOptions: ProctorOptions;
};

const inDays = (d: number, h: number) => {
  const x = new Date(Date.now() + d * 86_400_000);
  x.setHours(h, 0, 0, 0);
  return toLocalInput(x.toISOString());
};

const blank: Form = {
  slug: '', titleEn: '', titleHi: '', descriptionEn: '', descriptionHi: '', rulesEn: '', rulesHi: '', scoringEn: '', scoringHi: '',
  refundPolicyEn: '', refundPolicyHi: '', examId: '', subjectId: '', testId: '', format: 'MASS', entryMode: 'FREE', entryFeeRupees: '0',
  platformFeePercent: '0', rewardType: 'SCHOLARSHIP', fundingSource: 'PLATFORM', sponsorName: '',
  prizeTiers: [{ fromRank: 1, toRank: 1, amountPaise: 0, rewardEn: '', rewardHi: '' }],
  maxParticipants: '1000', minParticipants: '10',
  registrationOpensAt: inDays(1, 10), registrationClosesAt: inDays(6, 17), startsAt: inDays(6, 18), endsAt: inDays(6, 20),
  durationMinutes: '60', questionCount: '50',
  eligibility: { audience: [], classLevels: [], examIds: [], minAge: '', maxAge: '', requiresVerifiedEmail: false },
  bannerColor: '#1E3A8A', featured: false, proctorMode: 'OFF', proctorOptions: {},
};

const s = (v: unknown) => (v == null ? '' : String(v));

function fromApi(t: Record<string, unknown>): Form {
  const el = (t.eligibility ?? {}) as Record<string, unknown>;
  return {
    slug: s(t.slug), titleEn: s(t.titleEn), titleHi: s(t.titleHi), descriptionEn: s(t.descriptionEn), descriptionHi: s(t.descriptionHi),
    rulesEn: s(t.rulesEn), rulesHi: s(t.rulesHi), scoringEn: s(t.scoringEn), scoringHi: s(t.scoringHi),
    refundPolicyEn: s(t.refundPolicyEn), refundPolicyHi: s(t.refundPolicyHi), examId: s(t.examId), subjectId: s(t.subjectId), testId: s(t.testId),
    format: t.format as Form['format'], entryMode: t.entryMode as Form['entryMode'], entryFeeRupees: String(Number(t.entryFeePaise) / 100),
    platformFeePercent: s(t.platformFeePercent), rewardType: t.rewardType as Form['rewardType'], fundingSource: t.fundingSource as Form['fundingSource'],
    sponsorName: s(t.sponsorName), prizeTiers: (t.prizeTiers as PrizeTier[]) ?? [], maxParticipants: s(t.maxParticipants), minParticipants: s(t.minParticipants),
    registrationOpensAt: toLocalInput(t.registrationOpensAt as string), registrationClosesAt: toLocalInput(t.registrationClosesAt as string),
    startsAt: toLocalInput(t.startsAt as string), endsAt: toLocalInput(t.endsAt as string), durationMinutes: s(t.durationMinutes), questionCount: s(t.questionCount),
    eligibility: { ...eligibilityFromApi(el), requiresVerifiedEmail: !!el.requiresVerifiedEmail },
    bannerColor: s(t.bannerColor) || '#1E3A8A', featured: !!t.featured, proctorMode: (t.proctorMode as ProctorMode) ?? 'OFF', proctorOptions: (t.proctorOptions as ProctorOptions) ?? {},
  };
}

function toPayload(f: Form) {
  const n = (v: string) => (v.trim() === '' ? null : Number(v));
  const t = (v: string) => v.trim() || null;
  return {
    slug: f.slug, titleEn: f.titleEn, titleHi: t(f.titleHi), descriptionEn: t(f.descriptionEn), descriptionHi: t(f.descriptionHi),
    rulesEn: t(f.rulesEn), rulesHi: t(f.rulesHi), scoringEn: t(f.scoringEn), scoringHi: t(f.scoringHi),
    refundPolicyEn: t(f.refundPolicyEn), refundPolicyHi: t(f.refundPolicyHi), examId: f.examId || null, subjectId: f.subjectId || null, testId: f.testId || null,
    format: f.format, entryMode: f.entryMode, entryFeePaise: f.entryMode === 'FREE' ? 0 : Math.round(Number(f.entryFeeRupees) * 100),
    platformFeePercent: Number(f.platformFeePercent) || 0, rewardType: f.rewardType, fundingSource: f.fundingSource, sponsorName: t(f.sponsorName),
    prizeTiers: f.prizeTiers.map((p) => ({ ...p, rewardEn: p.rewardEn || null, rewardHi: p.rewardHi || null })),
    maxParticipants: Number(f.maxParticipants), minParticipants: Number(f.minParticipants),
    registrationOpensAt: fromLocalInput(f.registrationOpensAt), registrationClosesAt: fromLocalInput(f.registrationClosesAt),
    startsAt: fromLocalInput(f.startsAt), endsAt: fromLocalInput(f.endsAt), durationMinutes: Number(f.durationMinutes), questionCount: Number(f.questionCount),
    eligibility: { ...eligibilityToApi(f.eligibility), requiresVerifiedEmail: f.eligibility.requiresVerifiedEmail },
    bannerColor: f.bannerColor, featured: f.featured, proctorMode: f.proctorMode, proctorOptions: f.proctorOptions,
  };
}

const slugify = (v: string) => v.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

const ACTION_LABEL: Partial<Record<TournamentStatus, string>> = {
  SCHEDULED: 'Publish (schedule)', REG_OPEN: 'Open registration now', REG_CLOSED: 'Close registration', DRAFT: 'Unpublish to draft',
  LIVE: 'Go live', IN_REVIEW: 'End & start review', FINAL: 'Finalise results', REWARDS_APPROVED: 'Approve rewards', CLOSED: 'Close', CANCELLED: 'Cancel tournament',
};

export function TournamentEditorPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: tax } = useTaxonomy();
  const testsQ = useQuery({ queryKey: ['tests', 'PUBLISHED', '', ''], queryFn: () => api<{ id: string; titleEn: string; kind: string; durationMinutes: number; _count: { questions: number } }[]>('/v1/admin/tests?status=PUBLISHED') });
  const [f, setF] = useState<Form>(blank);
  const [errors, setErrors] = useState<string[]>([]);
  const [changeModal, setChangeModal] = useState<string[] | null>(null);
  const [summary, setSummary] = useState({ en: '', hi: '' });
  const writable = can('tournament.write');

  const { data: t } = useQuery({
    queryKey: ['tournament', id],
    queryFn: () => api<Record<string, unknown> & { status: TournamentStatus; participantCount: number; publishedAt: string | null; ruleChanges: { id: string; summaryEn: string; createdAt: string }[]; cancelledReason: string | null }>(`/v1/admin/tournaments/${id}`),
    enabled: !isNew,
  });
  useEffect(() => {
    if (t) setF(fromApi(t));
  }, [t]);

  const save = useMutation({
    mutationFn: (change?: { summaryEn: string; summaryHi: string | null }) =>
      isNew
        ? api<{ id: string }>('/v1/admin/tournaments', { method: 'POST', json: toPayload(f) })
        : api<{ id: string }>(`/v1/admin/tournaments/${id}`, { method: 'PUT', json: { tournament: toPayload(f), change: change ?? {} } }),
    onSuccess: (r) => {
      setChangeModal(null);
      setSummary({ en: '', hi: '' });
      void qc.invalidateQueries({ queryKey: ['tournaments'] });
      void qc.invalidateQueries({ queryKey: ['tournament', r.id] });
      if (isNew) navigate(`/tournaments/${r.id}`, { replace: true });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.body?.changedFields) setChangeModal(e.body.changedFields);
    },
  });

  const transition = useMutation({
    mutationFn: (body: { to: TournamentStatus; reason?: string }) => api(`/v1/admin/tournaments/${id}/transition`, { method: 'POST', json: body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tournament', id] });
      void qc.invalidateQueries({ queryKey: ['tournaments'] });
    },
  });

  const duplicate = useMutation({
    mutationFn: () => api<{ id: string }>(`/v1/admin/tournaments/${id}/duplicate`, { method: 'POST' }),
    onSuccess: (r) => navigate(`/tournaments/${r.id}`),
  });

  const remove = useMutation({
    mutationFn: () => api(`/v1/admin/tournaments/${id}`, { method: 'DELETE' }),
    onSuccess: () => navigate('/tournaments'),
  });

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));
  const locked = !!t && !['DRAFT', 'SCHEDULED', 'REG_OPEN', 'REG_CLOSED'].includes(t.status);

  function submit() {
    const parsed = tournamentSchema.safeParse(toPayload(f));
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
      return;
    }
    setErrors([]);
    save.mutate(undefined);
  }

  const tiers = f.prizeTiers;
  const pool = prizePoolFromTiers(tiers);
  const winners = winnerCountFromTiers(tiers);
  const fee = f.entryMode === 'PAID' ? Math.round(Number(f.entryFeeRupees) * 100) : 0;

  return (
    <>
      <Link to="/tournaments" className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-ink"><ArrowLeft size={14} /> Tournaments</Link>
      <PageHeader
        title={isNew ? 'New tournament' : f.titleEn || 'Tournament'}
        subtitle={t ? `${t.participantCount} registered · ${t.publishedAt ? `published ${fmtDate(t.publishedAt)}` : 'not published'}` : 'Saved as a draft. Publish when ready.'}
        actions={t && (
          <>
            <Badge tone={statusTone(t.status)}>{t.status.replace('_', ' ')}</Badge>
            <Link to={`/tournaments/${t.id as string}/results`}><Button variant="secondary" size="sm"><Trophy size={14} /> Results</Button></Link>
            {writable && <Button variant="secondary" size="sm" onClick={() => duplicate.mutate()}><Copy size={14} /> Duplicate</Button>}
          </>
        )}
      />
      {t?.cancelledReason && <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700"><b>Cancelled:</b> {t.cancelledReason}</div>}
      {locked && <div className="mb-4 rounded-xl bg-gray-100 p-3 text-sm text-gray-600">This tournament is {t?.status.replace('_', ' ')} and can no longer be edited.</div>}

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <fieldset disabled={locked || !writable} className="min-w-0 space-y-6">
          <Card title="Basics">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Title (English)"><Input value={f.titleEn} onChange={(e) => setF((p) => ({ ...p, titleEn: e.target.value, slug: isNew ? slugify(e.target.value) : p.slug }))} /></Field>
              <Field label="शीर्षक (Hindi)"><Input className="hindi" value={f.titleHi} onChange={(e) => set('titleHi', e.target.value)} /></Field>
              <Field label="Slug" hint="Public link; cannot change after publishing"><Input value={f.slug} onChange={(e) => set('slug', e.target.value)} /></Field>
              <Field label="Format">
                <Select value={f.format} onChange={(e) => set('format', e.target.value as Form['format'])}>
                  <option value="MASS">Mass Test War</option><option value="KNOCKOUT">Knockout</option><option value="LEAGUE">League</option><option value="DUEL">Duel series</option>
                </Select>
              </Field>
              <Field label="Exam">
                <Select value={f.examId} onChange={(e) => set('examId', e.target.value)}>
                  <option value="">All / none</option>
                  {tax?.exams.map((e) => <option key={e.id} value={e.id}>{e.nameEn}</option>)}
                </Select>
              </Field>
              <Field label="Subject (optional)">
                <Select value={f.subjectId} onChange={(e) => set('subjectId', e.target.value)}>
                  <option value="">Mixed</option>
                  {tax?.subjects.map((s) => <option key={s.id} value={s.id}>{s.nameEn}</option>)}
                </Select>
              </Field>
              <Field label="Test paper" hint="Published tests only. Required before going live. Students get this paper with the timer below." className="md:col-span-2">
                <Select value={f.testId} onChange={(e) => {
                  const test = testsQ.data?.find((x) => x.id === e.target.value);
                  setF((p) => ({ ...p, testId: e.target.value, ...(test && { durationMinutes: String(test.durationMinutes), questionCount: String(test._count.questions) }) }));
                }}>
                  <option value="">— Not attached yet —</option>
                  {testsQ.data?.map((x) => <option key={x.id} value={x.id}>{x.titleEn} · {x._count.questions} Qs · {x.durationMinutes} min ({x.kind})</option>)}
                </Select>
              </Field>
              <Field label="Description (English)"><Textarea value={f.descriptionEn} onChange={(e) => set('descriptionEn', e.target.value)} /></Field>
              <Field label="विवरण (Hindi)"><Textarea className="hindi" value={f.descriptionHi} onChange={(e) => set('descriptionHi', e.target.value)} /></Field>
            </div>
          </Card>

          <Card title="Schedule & capacity">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Field label="Registration opens"><Input type="datetime-local" value={f.registrationOpensAt} onChange={(e) => set('registrationOpensAt', e.target.value)} /></Field>
              <Field label="Registration closes"><Input type="datetime-local" value={f.registrationClosesAt} onChange={(e) => set('registrationClosesAt', e.target.value)} /></Field>
              <Field label="Test window starts"><Input type="datetime-local" value={f.startsAt} onChange={(e) => set('startsAt', e.target.value)} /></Field>
              <Field label="Test window ends"><Input type="datetime-local" value={f.endsAt} onChange={(e) => set('endsAt', e.target.value)} /></Field>
              <Field label="Duration (minutes)"><Input type="number" min={1} value={f.durationMinutes} onChange={(e) => set('durationMinutes', e.target.value)} /></Field>
              <Field label="Questions"><Input type="number" min={1} value={f.questionCount} onChange={(e) => set('questionCount', e.target.value)} /></Field>
              <Field label="Max participants"><Input type="number" min={2} value={f.maxParticipants} onChange={(e) => set('maxParticipants', e.target.value)} /></Field>
              <Field label="Min participants" hint="Below this the event is cancelled"><Input type="number" min={1} value={f.minParticipants} onChange={(e) => set('minParticipants', e.target.value)} /></Field>
            </div>
          </Card>

          <Card title="Entry & rewards">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Field label="Entry">
                <Select value={f.entryMode} onChange={(e) => setF((p) => ({ ...p, entryMode: e.target.value as Form['entryMode'], entryFeeRupees: e.target.value === 'FREE' ? '0' : p.entryFeeRupees }))}>
                  <option value="FREE">Free</option><option value="PAID">Paid</option>
                </Select>
              </Field>
              <Field label="Entry fee (₹)"><Input type="number" min={0} step="1" disabled={f.entryMode === 'FREE'} value={f.entryFeeRupees} onChange={(e) => set('entryFeeRupees', e.target.value)} /></Field>
              <Field label="Platform fee %"><Input type="number" min={0} max={100} value={f.platformFeePercent} onChange={(e) => set('platformFeePercent', e.target.value)} /></Field>
              <Field label="Reward type">
                <Select value={f.rewardType} onChange={(e) => set('rewardType', e.target.value as Form['rewardType'])}>
                  {['NONE', 'SCHOLARSHIP', 'VOUCHER', 'MERCHANDISE', 'CASH', 'MIXED'].map((r) => <option key={r}>{r}</option>)}
                </Select>
              </Field>
              <Field label="Prizes funded by">
                <Select value={f.fundingSource} onChange={(e) => set('fundingSource', e.target.value as Form['fundingSource'])}>
                  <option value="PLATFORM">Platform</option><option value="SPONSOR">Sponsor</option><option value="ENTRY_FEES">Entry fees</option>
                </Select>
              </Field>
              <Field label="Sponsor name"><Input value={f.sponsorName} onChange={(e) => set('sponsorName', e.target.value)} /></Field>
            </div>
            <p className="mt-2 text-xs text-gray-500">Paid entry, cash prizes and entry-funded prizes stay blocked at publish time until enabled in Settings → Money model.</p>

            <h3 className="mb-2 mt-6 text-sm font-bold">Prize table</h3>
            <div className="space-y-2">
              {tiers.map((p, i) => (
                <div key={i} className="grid items-end gap-2 rounded-xl border border-gray-100 p-3 md:grid-cols-[80px_80px_120px_1fr_1fr_auto]">
                  <Field label="From rank"><Input type="number" min={1} value={p.fromRank} onChange={(e) => set('prizeTiers', tiers.map((x, j) => (j === i ? { ...x, fromRank: Number(e.target.value) } : x)))} /></Field>
                  <Field label="To rank"><Input type="number" min={1} value={p.toRank} onChange={(e) => set('prizeTiers', tiers.map((x, j) => (j === i ? { ...x, toRank: Number(e.target.value) } : x)))} /></Field>
                  <Field label="Cash each (₹)"><Input type="number" min={0} value={p.amountPaise / 100} onChange={(e) => set('prizeTiers', tiers.map((x, j) => (j === i ? { ...x, amountPaise: Math.round(Number(e.target.value) * 100) } : x)))} /></Field>
                  <Field label="Reward (English)"><Input value={p.rewardEn ?? ''} onChange={(e) => set('prizeTiers', tiers.map((x, j) => (j === i ? { ...x, rewardEn: e.target.value } : x)))} placeholder="e.g. 6-month Pro pass" /></Field>
                  <Field label="पुरस्कार (Hindi)"><Input className="hindi" value={p.rewardHi ?? ''} onChange={(e) => set('prizeTiers', tiers.map((x, j) => (j === i ? { ...x, rewardHi: e.target.value } : x)))} /></Field>
                  <button type="button" onClick={() => set('prizeTiers', tiers.filter((_, j) => j !== i))} className="mb-2 p-2 text-gray-400 hover:text-red-600" aria-label="Remove tier"><Trash2 size={16} /></button>
                </div>
              ))}
              <Button type="button" variant="secondary" size="sm" onClick={() => {
                const last = tiers[tiers.length - 1];
                const from = last ? last.toRank + 1 : 1;
                set('prizeTiers', [...tiers, { fromRank: from, toRank: from, amountPaise: 0, rewardEn: '', rewardHi: '' }]);
              }}><Plus size={14} /> Add tier</Button>
            </div>
          </Card>

          <Card title="Who can join">
            <AudiencePicker value={f.eligibility} onChange={(v) => set('eligibility', { ...f.eligibility, ...v })} exams={tax?.exams ?? []} />
          </Card>

          <Card title="Rules, scoring & refunds (shown on the public transparency page)">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Rules (English)"><Textarea rows={4} value={f.rulesEn} onChange={(e) => set('rulesEn', e.target.value)} /></Field>
              <Field label="नियम (Hindi)"><Textarea rows={4} className="hindi" value={f.rulesHi} onChange={(e) => set('rulesHi', e.target.value)} /></Field>
              <Field label="Scoring & tie-breaks (English)"><Textarea rows={3} value={f.scoringEn} onChange={(e) => set('scoringEn', e.target.value)} /></Field>
              <Field label="अंकन (Hindi)"><Textarea rows={3} className="hindi" value={f.scoringHi} onChange={(e) => set('scoringHi', e.target.value)} /></Field>
              <Field label="Cancellation & refunds (English)"><Textarea rows={3} value={f.refundPolicyEn} onChange={(e) => set('refundPolicyEn', e.target.value)} /></Field>
              <Field label="रद्दीकरण और रिफंड (Hindi)"><Textarea rows={3} className="hindi" value={f.refundPolicyHi} onChange={(e) => set('refundPolicyHi', e.target.value)} /></Field>
            </div>
          </Card>

          <Card title="Proctoring">
            <div className="grid gap-3 md:grid-cols-[260px_1fr]">
              <Field label="Proctoring mode">
                <Select value={f.proctorMode} onChange={(e) => { set('proctorMode', e.target.value as ProctorMode); set('proctorOptions', {}); }}>
                  {(Object.keys(PROCTOR_MODE_INFO) as ProctorMode[]).map((m) => <option key={m} value={m}>{PROCTOR_MODE_INFO[m].labelEn}</option>)}
                </Select>
              </Field>
              <div className="text-sm text-gray-600">
                <p>{PROCTOR_MODE_INFO[f.proctorMode].descriptionEn}</p>
                {f.entryMode === 'PAID' && f.rewardType !== 'NONE' && f.proctorMode !== 'LIVE' && <p className="mt-1 font-semibold text-amber-700">Recommended: Live proctoring for paid tournaments with rewards.</p>}
                {(f.proctorMode === 'AI' || f.proctorMode === 'LIVE') && <p className="mt-1 text-xs text-gray-500">Students must use the mobile app, accept monitoring, pass the device check (no remote-access apps) and show their face before starting. Under-18s can’t register unless allowed in Settings → Proctoring. Thresholds and rules: Settings → Proctoring.</p>}
              </div>
            </div>
            <ProctorOptionsEditor mode={f.proctorMode} value={f.proctorOptions} onChange={(v) => set('proctorOptions', v)} />
          </Card>

          <Card title="Appearance">
            <div className="flex flex-wrap items-end gap-6">
              <Field label="Card colour"><Input type="color" value={f.bannerColor} onChange={(e) => set('bannerColor', e.target.value)} className="h-10 w-24 p-1" /></Field>
              <Toggle checked={f.featured} onChange={(v) => set('featured', v)} label="Feature on Home" />
            </div>
          </Card>

          {errors.length > 0 && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><ul className="list-disc pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul></div>}
          {!changeModal && <ErrorBox error={save.error} />}
          {writable && !locked && <Button onClick={submit} disabled={save.isPending}>{save.isPending ? 'Saving…' : isNew ? 'Create draft' : 'Save changes'}</Button>}
        </fieldset>

        <div className="space-y-6">
          <Card title="Summary">
            <dl className="space-y-2 text-sm">
              <Row k="Entry" v={f.entryMode === 'FREE' ? 'Free' : formatRupees(fee)} />
              <Row k="Winners" v={`${winners} rank${winners === 1 ? '' : 's'}`} />
              <Row k="Cash prize pool" v={formatRupees(pool)} />
              {f.entryMode === 'PAID' && <Row k="Collected if full" v={formatRupees(fee * Number(f.maxParticipants || 0))} />}
              <Row k="Funding" v={f.fundingSource.replace('_', ' ').toLowerCase()} />
            </dl>
          </Card>

          {t && writable && (
            <Card title="Lifecycle">
              <p className="mb-3 text-xs text-gray-500">Registration opens and closes automatically at the scheduled times.</p>
              <div className="flex flex-col gap-2">
                {TOURNAMENT_TRANSITIONS[t.status].map((to) => (
                  <Button
                    key={to}
                    variant={to === 'CANCELLED' ? 'danger' : to === 'DRAFT' ? 'secondary' : 'primary'}
                    size="sm"
                    disabled={transition.isPending}
                    onClick={() => {
                      if (to === 'CANCELLED') {
                        const reason = window.prompt('Reason for cancellation (shown to students)');
                        if (reason) transition.mutate({ to, reason });
                      } else transition.mutate({ to });
                    }}
                  >
                    {ACTION_LABEL[to] ?? to}
                  </Button>
                ))}
                {t.status === 'DRAFT' && <Button variant="ghost" size="sm" className="text-red-600" onClick={() => window.confirm('Delete this draft?') && remove.mutate()}>Delete draft</Button>}
              </div>
              <div className="mt-3"><ErrorBox error={transition.error} /></div>
            </Card>
          )}

          {t && t.ruleChanges.length > 0 && (
            <Card title="Public rule-change history">
              <ul className="space-y-3 text-sm">
                {t.ruleChanges.map((r) => (
                  <li key={r.id}><p>{r.summaryEn}</p><p className="text-xs text-gray-400">{fmtDate(r.createdAt)}</p></li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <Modal open={!!changeModal} onClose={() => setChangeModal(null)} title="Disclose this change">
        <p className="text-sm text-gray-600">This tournament is public. Students will see this note in the rule-change history.</p>
        <p className="mt-2 text-xs text-gray-500">Changed: {changeModal?.join(', ')}</p>
        <div className="mt-4 space-y-3">
          <Field label="What changed (English)"><Textarea value={summary.en} onChange={(e) => setSummary({ ...summary, en: e.target.value })} placeholder="e.g. Test window moved from 6 PM to 7 PM due to a server upgrade." /></Field>
          <Field label="क्या बदला (Hindi)"><Textarea className="hindi" value={summary.hi} onChange={(e) => setSummary({ ...summary, hi: e.target.value })} /></Field>
        </div>
        <div className="mt-4"><ErrorBox error={changeModal && save.error instanceof ApiError && !save.error.body?.changedFields ? save.error : null} /></div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setChangeModal(null)}>Cancel</Button>
          <Button disabled={summary.en.trim().length < 3 || save.isPending} onClick={() => save.mutate({ summaryEn: summary.en, summaryHi: summary.hi || null })}>Save & publish note</Button>
        </div>
      </Modal>
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-gray-500">{k}</dt>
      <dd className="font-semibold capitalize">{v}</dd>
    </div>
  );
}
