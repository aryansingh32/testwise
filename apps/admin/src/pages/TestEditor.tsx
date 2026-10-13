import { ProctorOptionsEditor } from '../components/ProctorOptions';
import { PROCTOR_MODE_INFO,
  type ProctorOptions, type ProctorMode } from '@testwise/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, Copy, Plus, Search, Shuffle, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { MathText } from '../components/MathText';
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, Textarea, Toggle, statusTone } from '../components/ui';
import { api, can } from '../lib/api';
import { useTaxonomy } from '../lib/hooks';

interface QRef {
  id: string;
  refId: string | null;
  textEn: string;
  type: string;
  difficulty: string;
  status?: string;
  marks: number;
  negativeMarks: number;
  subject?: { nameEn: string };
}

interface SectionState {
  key: string;
  titleEn: string;
  titleHi: string;
  questions: { q: QRef; marks: string; negativeMarks: string }[];
}

interface Form {
  titleEn: string;
  titleHi: string;
  instructionsEn: string;
  instructionsHi: string;
  examId: string;
  kind: string;
  durationMinutes: string;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  allowLanguageSwitch: boolean;
  answerKeyPolicy: string;
  maxAttempts: string;
  proctorMode: ProctorMode;
  proctorOptions: ProctorOptions;
  sections: SectionState[];
}

const newKey = () => Math.random().toString(36).slice(2);
const blank: Form = {
  titleEn: '', titleHi: '', instructionsEn: '', instructionsHi: '', examId: '', kind: 'MOCK', durationMinutes: '30',
  shuffleQuestions: false, shuffleOptions: false, allowLanguageSwitch: true, answerKeyPolicy: 'ON_SUBMIT', maxAttempts: '3', proctorMode: 'OFF', proctorOptions: {},
  sections: [{ key: newKey(), titleEn: 'Section 1', titleHi: '', questions: [] }],
};

const POLICY_HELP: Record<string, string> = {
  ON_SUBMIT: 'Solutions show as soon as the student submits.',
  AFTER_WINDOW: 'For tournaments: solutions unlock when the test window closes.',
  AFTER_FINAL: 'For tournaments: solutions unlock when results are final.',
  NEVER: 'Solutions are never shown.',
};

export function TestEditorPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: tax } = useTaxonomy();
  const [f, setF] = useState<Form>(blank);
  const [picker, setPicker] = useState<string | null>(null);
  const writable = can('content.write');

  type Detail = Record<string, unknown> & {
    status: string;
    _count: { attempts: number };
    sections: { id: string; titleEn: string; titleHi: string | null; questions: { questionId: string; marks: number | null; negativeMarks: number | null; question: QRef }[] }[];
    series: { series: { id: string; titleEn: string } }[];
    tournaments: { id: string; titleEn: string; status: string }[];
  };
  const { data: t } = useQuery({ queryKey: ['test', id], queryFn: () => api<Detail>(`/v1/admin/tests/${id}`), enabled: !isNew });

  useEffect(() => {
    if (!t) return;
    const s = (v: unknown) => (v == null ? '' : String(v));
    setF({
      titleEn: s(t.titleEn), titleHi: s(t.titleHi), instructionsEn: s(t.instructionsEn), instructionsHi: s(t.instructionsHi), examId: s(t.examId),
      kind: s(t.kind), durationMinutes: s(t.durationMinutes), shuffleQuestions: !!t.shuffleQuestions, shuffleOptions: !!t.shuffleOptions,
      allowLanguageSwitch: !!t.allowLanguageSwitch, answerKeyPolicy: s(t.answerKeyPolicy), maxAttempts: s(t.maxAttempts), proctorMode: (t.proctorMode as ProctorMode) ?? 'OFF', proctorOptions: (t.proctorOptions as ProctorOptions) ?? {},
      sections: t.sections.map((sec) => ({
        key: sec.id, titleEn: sec.titleEn, titleHi: sec.titleHi ?? '',
        questions: sec.questions.map((x) => ({ q: x.question, marks: x.marks == null ? '' : String(x.marks), negativeMarks: x.negativeMarks == null ? '' : String(x.negativeMarks) })),
      })),
    });
  }, [t]);

  const locked = !!t && t._count.attempts > 0;
  const allIds = useMemo(() => f.sections.flatMap((s) => s.questions.map((x) => x.q.id)), [f.sections]);
  const totals = useMemo(() => {
    const qs = f.sections.flatMap((s) => s.questions);
    return { count: qs.length, marks: qs.reduce((sum, x) => sum + (x.marks === '' ? x.q.marks : Number(x.marks)), 0) };
  }, [f.sections]);

  const payload = () => ({
    titleEn: f.titleEn, titleHi: f.titleHi || null, instructionsEn: f.instructionsEn || null, instructionsHi: f.instructionsHi || null,
    examId: f.examId || null, kind: f.kind, durationMinutes: Number(f.durationMinutes), shuffleQuestions: f.shuffleQuestions,
    shuffleOptions: f.shuffleOptions, allowLanguageSwitch: f.allowLanguageSwitch, answerKeyPolicy: f.answerKeyPolicy, maxAttempts: Number(f.maxAttempts), proctorMode: f.proctorMode, proctorOptions: f.proctorOptions,
    sections: f.sections.map((s) => ({
      titleEn: s.titleEn, titleHi: s.titleHi || null,
      questions: s.questions.map((x) => ({ questionId: x.q.id, marks: x.marks === '' ? null : Number(x.marks), negativeMarks: x.negativeMarks === '' ? null : Number(x.negativeMarks) })),
    })),
  });

  const save = useMutation({
    mutationFn: () => (isNew ? api<{ id: string }>('/v1/admin/tests', { method: 'POST', json: payload() }) : api<{ id: string }>(`/v1/admin/tests/${id}`, { method: 'PUT', json: payload() })),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['tests'] });
      void qc.invalidateQueries({ queryKey: ['test', r.id] });
      if (isNew) navigate(`/tests/${r.id}`, { replace: true });
    },
  });
  const setStatus = useMutation({
    mutationFn: (status: string) => api(`/v1/admin/tests/${id}/status`, { method: 'POST', json: { status } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['test', id] });
      void qc.invalidateQueries({ queryKey: ['tests'] });
    },
  });
  const duplicate = useMutation({ mutationFn: () => api<{ id: string }>(`/v1/admin/tests/${id}/duplicate`, { method: 'POST' }), onSuccess: (r) => navigate(`/tests/${r.id}`) });
  const remove = useMutation({ mutationFn: () => api(`/v1/admin/tests/${id}`, { method: 'DELETE' }), onSuccess: () => navigate('/tests') });

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));
  const setSection = (key: string, patch: Partial<SectionState>) => set('sections', f.sections.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const addQuestions = (key: string, qs: QRef[]) => {
    const existing = new Set(allIds);
    setSection(key, { questions: [...(f.sections.find((s) => s.key === key)?.questions ?? []), ...qs.filter((q) => !existing.has(q.id)).map((q) => ({ q, marks: '', negativeMarks: '' }))] });
  };
  const moveQ = (key: string, i: number, d: -1 | 1) => {
    const s = f.sections.find((x) => x.key === key)!;
    const next = [...s.questions];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setSection(key, { questions: next });
  };

  return (
    <>
      <Link to="/tests" className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-ink"><ArrowLeft size={14} /> Tests</Link>
      <PageHeader
        title={isNew ? 'New test' : f.titleEn || 'Test'}
        subtitle={`${totals.count} questions · ${totals.marks} marks · ${f.durationMinutes || 0} min`}
        actions={t && (
          <>
            <Badge tone={statusTone(t.status === 'PUBLISHED' ? 'APPROVED' : t.status === 'ARCHIVED' ? 'RETIRED' : 'DRAFT')}>{t.status}</Badge>
            {writable && <Button size="sm" variant="secondary" onClick={() => duplicate.mutate()}><Copy size={14} /> Duplicate</Button>}
          </>
        )}
      />
      {locked && <div className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{t!._count.attempts} attempt(s) exist, so this paper is frozen. Duplicate it to make a new version.</div>}

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <fieldset disabled={locked || !writable} className="min-w-0 space-y-6">
          <Card title="Details">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Title (English)"><Input value={f.titleEn} onChange={(e) => set('titleEn', e.target.value)} /></Field>
              <Field label="शीर्षक (Hindi)"><Input className="hindi" value={f.titleHi} onChange={(e) => set('titleHi', e.target.value)} /></Field>
              <Field label="Kind">
                <Select value={f.kind} onChange={(e) => set('kind', e.target.value)}>
                  {['MOCK', 'SECTIONAL', 'PRACTICE', 'PREVIOUS_YEAR', 'TOURNAMENT'].map((k) => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}
                </Select>
              </Field>
              <Field label="Exam">
                <Select value={f.examId} onChange={(e) => set('examId', e.target.value)}>
                  <option value="">Any</option>
                  {tax?.exams.map((e) => <option key={e.id} value={e.id}>{e.nameEn}</option>)}
                </Select>
              </Field>
              <Field label="Duration (minutes)"><Input type="number" min={1} value={f.durationMinutes} onChange={(e) => set('durationMinutes', e.target.value)} /></Field>
              <Field label="Proctoring (practice attempts)" hint={PROCTOR_MODE_INFO[f.proctorMode].descriptionEn}>
                <Select value={f.proctorMode} onChange={(e) => { set('proctorMode', e.target.value as ProctorMode); set('proctorOptions', {}); }}>
                  {(Object.keys(PROCTOR_MODE_INFO) as ProctorMode[]).map((m) => <option key={m} value={m}>{PROCTOR_MODE_INFO[m].labelEn}</option>)}
                </Select>
              </Field>
              <div className="md:col-span-2"><ProctorOptionsEditor mode={f.proctorMode} value={f.proctorOptions} onChange={(v) => set('proctorOptions', v)} /></div>
              <Field label="Attempts allowed (practice)"><Input type="number" min={1} value={f.maxAttempts} onChange={(e) => set('maxAttempts', e.target.value)} /></Field>
              <Field label="Answer key" hint={POLICY_HELP[f.answerKeyPolicy]}>
                <Select value={f.answerKeyPolicy} onChange={(e) => set('answerKeyPolicy', e.target.value)}>
                  <option value="ON_SUBMIT">On submit</option><option value="AFTER_WINDOW">After test window</option><option value="AFTER_FINAL">After final results</option><option value="NEVER">Never</option>
                </Select>
              </Field>
              <div className="flex flex-col justify-end gap-2 pb-1">
                <Toggle checked={f.shuffleQuestions} onChange={(v) => set('shuffleQuestions', v)} label="Shuffle questions per student" />
                <Toggle checked={f.shuffleOptions} onChange={(v) => set('shuffleOptions', v)} label="Shuffle options per student" />
                <Toggle checked={f.allowLanguageSwitch} onChange={(v) => set('allowLanguageSwitch', v)} label="Allow EN/HI switch during test" />
              </div>
              <Field label="Instructions (English)"><Textarea value={f.instructionsEn} onChange={(e) => set('instructionsEn', e.target.value)} /></Field>
              <Field label="निर्देश (Hindi)"><Textarea className="hindi" value={f.instructionsHi} onChange={(e) => set('instructionsHi', e.target.value)} /></Field>
            </div>
          </Card>

          {f.sections.map((s, si) => (
            <Card
              key={s.key}
              title={<div className="flex flex-wrap items-center gap-2"><Input value={s.titleEn} onChange={(e) => setSection(s.key, { titleEn: e.target.value })} className="w-56" /><Input value={s.titleHi} placeholder="हिन्दी नाम" className="hindi w-48" onChange={(e) => setSection(s.key, { titleHi: e.target.value })} /></div>}
              actions={
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setPicker(s.key)}><Plus size={14} /> Add questions</Button>
                  {f.sections.length > 1 && <Button size="sm" variant="ghost" onClick={() => set('sections', f.sections.filter((x) => x.key !== s.key))} aria-label="Remove section"><Trash2 size={14} /></Button>}
                </div>
              }
            >
              {s.questions.length === 0 ? (
                <p className="text-sm text-gray-500">No questions in section {si + 1} yet.</p>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {s.questions.map((x, i) => (
                    <li key={x.q.id} className="flex items-start gap-3 py-2">
                      <span className="w-6 pt-1 text-xs text-gray-400">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm"><MathText text={x.q.textEn} /></p>
                        <p className="text-xs text-gray-400">
                          {x.q.refId ?? '—'} · {x.q.type} · {x.q.difficulty}
                          {x.q.status && x.q.status !== 'APPROVED' && <span className="ml-1 font-semibold text-amber-600">{x.q.status}</span>}
                        </p>
                      </div>
                      <Input className="w-20" placeholder={String(x.q.marks)} title="Marks override" value={x.marks} onChange={(e) => setSection(s.key, { questions: s.questions.map((y, j) => (j === i ? { ...y, marks: e.target.value } : y)) })} />
                      <Input className="w-20" placeholder={`-${x.q.negativeMarks}`} title="Negative marks override" value={x.negativeMarks} onChange={(e) => setSection(s.key, { questions: s.questions.map((y, j) => (j === i ? { ...y, negativeMarks: e.target.value } : y)) })} />
                      <div className="flex flex-col">
                        <button type="button" disabled={i === 0} onClick={() => moveQ(s.key, i, -1)} className="text-gray-400 disabled:opacity-20" aria-label="Up"><ArrowUp size={14} /></button>
                        <button type="button" disabled={i === s.questions.length - 1} onClick={() => moveQ(s.key, i, 1)} className="text-gray-400 disabled:opacity-20" aria-label="Down"><ArrowDown size={14} /></button>
                      </div>
                      <button type="button" onClick={() => setSection(s.key, { questions: s.questions.filter((_, j) => j !== i) })} className="p-1 text-gray-400 hover:text-red-600" aria-label="Remove"><X size={16} /></button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
          <Button variant="secondary" onClick={() => set('sections', [...f.sections, { key: newKey(), titleEn: `Section ${f.sections.length + 1}`, titleHi: '', questions: [] }])}><Plus size={14} /> Add section</Button>

          <ErrorBox error={save.error} />
          {writable && !locked && <div><Button onClick={() => save.mutate()} disabled={save.isPending || !f.titleEn}>{save.isPending ? 'Saving…' : isNew ? 'Create draft' : 'Save changes'}</Button></div>}
        </fieldset>

        <div className="space-y-6">
          {t && (
            <Card title="Publishing">
              <p className="mb-3 text-xs text-gray-500">Publishing requires every question to be approved. Published tests can be added to series and tournaments.</p>
              <div className="flex flex-col gap-2">
                {t.status !== 'PUBLISHED' && can('content.review') && <Button size="sm" onClick={() => setStatus.mutate('PUBLISHED')}>Publish</Button>}
                {t.status === 'PUBLISHED' && can('content.review') && <Button size="sm" variant="secondary" onClick={() => setStatus.mutate('ARCHIVED')}>Archive</Button>}
                {t.status === 'ARCHIVED' && can('content.review') && <Button size="sm" variant="secondary" onClick={() => setStatus.mutate('DRAFT')}>Back to draft</Button>}
                {!locked && writable && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => window.confirm('Delete this test?') && remove.mutate()}>Delete</Button>}
              </div>
              <div className="mt-3"><ErrorBox error={setStatus.error ?? remove.error} /></div>
            </Card>
          )}
          {t && (
            <Card title="Used in">
              <ul className="space-y-1 text-sm">
                {t.series.map((s) => <li key={s.series.id}><Link className="hover:text-brand-600" to={`/store/series/${s.series.id}`}>Series: {s.series.titleEn}</Link></li>)}
                {t.tournaments.map((x) => <li key={x.id}><Link className="hover:text-brand-600" to={`/tournaments/${x.id}`}>Tournament: {x.titleEn}</Link> <Badge tone={statusTone(x.status)}>{x.status}</Badge></li>)}
                {!t.series.length && !t.tournaments.length && <li className="text-gray-500">Not used yet</li>}
              </ul>
            </Card>
          )}
        </div>
      </div>

      {picker && <QuestionPicker excludeIds={allIds} onClose={() => setPicker(null)} onAdd={(qs) => { addQuestions(picker, qs); setPicker(null); }} />}
    </>
  );
}

function QuestionPicker({ excludeIds, onClose, onAdd }: { excludeIds: string[]; onClose: () => void; onAdd: (qs: QRef[]) => void }) {
  const { data: tax } = useTaxonomy();
  const [filters, setFilters] = useState({ q: '', examId: '', subjectId: '', topicId: '', difficulty: '' });
  const [picked, setPicked] = useState<Map<string, QRef>>(new Map());
  const [count, setCount] = useState('10');
  const params = new URLSearchParams({ status: 'APPROVED', pageSize: '50', ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) });
  const { data } = useQuery({ queryKey: ['picker', params.toString()], queryFn: () => api<{ items: QRef[]; total: number }>(`/v1/admin/questions?${params}`) });
  const assemble = useMutation({
    mutationFn: () => api<{ available: number; picked: QRef[] }>('/v1/admin/tests/assemble', {
      method: 'POST',
      json: { examId: filters.examId || null, subjectId: filters.subjectId || null, topicId: filters.topicId || null, difficulty: filters.difficulty || null, count: Number(count), excludeIds },
    }),
    onSuccess: (r) => setPicked(new Map(r.picked.map((q) => [q.id, q]))),
  });
  const topics = tax?.subjects.find((s) => s.id === filters.subjectId)?.topics ?? [];
  const toggle = (q: QRef) => {
    const next = new Map(picked);
    if (next.has(q.id)) next.delete(q.id);
    else next.set(q.id, q);
    setPicked(next);
  };
  return (
    <Modal open onClose={onClose} title="Add approved questions" wide>
      <div className="grid gap-2 md:grid-cols-5">
        <Input placeholder="Search text or ref_id" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} className="md:col-span-2" />
        <Select value={filters.examId} onChange={(e) => setFilters({ ...filters, examId: e.target.value })}><option value="">Any exam</option>{tax?.exams.map((e) => <option key={e.id} value={e.id}>{e.nameEn}</option>)}</Select>
        <Select value={filters.subjectId} onChange={(e) => setFilters({ ...filters, subjectId: e.target.value, topicId: '' })}><option value="">Any subject</option>{tax?.subjects.map((s) => <option key={s.id} value={s.id}>{s.nameEn}</option>)}</Select>
        <Select value={filters.difficulty} onChange={(e) => setFilters({ ...filters, difficulty: e.target.value })}><option value="">Any difficulty</option>{['EASY', 'MEDIUM', 'HARD'].map((d) => <option key={d}>{d}</option>)}</Select>
        {topics.length > 0 && <Select value={filters.topicId} onChange={(e) => setFilters({ ...filters, topicId: e.target.value })}><option value="">Any topic</option>{topics.map((t) => <option key={t.id} value={t.id}>{t.nameEn}</option>)}</Select>}
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-xl bg-gray-50 p-3 text-sm">
        <Shuffle size={16} className="text-brand-600" /> Auto-pick
        <Input type="number" min={1} max={200} value={count} onChange={(e) => setCount(e.target.value)} className="w-20" />
        random questions matching the filters
        <Button size="sm" variant="secondary" onClick={() => assemble.mutate()} disabled={assemble.isPending}>Pick</Button>
        {assemble.data && <span className="text-xs text-gray-500">{assemble.data.available} available</span>}
      </div>
      <ErrorBox error={assemble.error} />
      <div className="mt-3 max-h-[50vh] overflow-y-auto rounded-xl border border-gray-100">
        {(data?.items ?? []).filter((q) => !excludeIds.includes(q.id)).map((q) => (
          <label key={q.id} className="flex cursor-pointer items-start gap-3 border-b border-gray-50 p-3 hover:bg-gray-50">
            <input type="checkbox" checked={picked.has(q.id)} onChange={() => toggle(q)} className="mt-1" />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm"><MathText text={q.textEn} /></p>
              <p className="text-xs text-gray-400">{q.refId ?? '—'} · {q.type} · {q.difficulty} · {q.marks} marks</p>
            </div>
          </label>
        ))}
        {!data?.items.length && <p className="flex items-center gap-2 p-4 text-sm text-gray-500"><Search size={14} /> No approved questions match.</p>}
      </div>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-sm text-gray-500">{picked.size} selected</span>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!picked.size} onClick={() => onAdd([...picked.values()])}>Add {picked.size}</Button>
        </div>
      </div>
    </Modal>
  );
}
