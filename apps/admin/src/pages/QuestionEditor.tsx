import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OPTION_LABELS, questionSchema } from '@testwise/shared';
import { ArrowLeft, ImagePlus, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { MathText } from '../components/MathText';
import { Badge, Button, Card, ErrorBox, Field, fmtDate, Input, PageHeader, Select, statusTone, Textarea, cx } from '../components/ui';
import { api, ApiError, can } from '../lib/api';
import { useTaxonomy } from '../lib/hooks';

type Label = (typeof OPTION_LABELS)[number];

interface FormState {
  refId: string;
  type: 'MCQ_SINGLE' | 'MCQ_MULTI' | 'NUMERIC';
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  examId: string;
  subjectId: string;
  topicId: string;
  classLevel: string;
  textEn: string;
  textHi: string;
  solutionEn: string;
  solutionHi: string;
  imageUrl: string;
  solutionImageUrl: string;
  options: { label: Label; textEn: string; textHi: string }[];
  correctLabels: Label[];
  correctNumeric: string;
  numericTolerance: string;
  marks: string;
  negativeMarks: string;
  tags: string;
  source: string;
  licence: string;
}

const blank: FormState = {
  refId: '', type: 'MCQ_SINGLE', difficulty: 'MEDIUM', examId: '', subjectId: '', topicId: '', classLevel: '',
  textEn: '', textHi: '', solutionEn: '', solutionHi: '', imageUrl: '', solutionImageUrl: '',
  options: OPTION_LABELS.slice(0, 4).map((label) => ({ label, textEn: '', textHi: '' })),
  correctLabels: [], correctNumeric: '', numericTolerance: '', marks: '1', negativeMarks: '0', tags: '', source: '', licence: '',
};

interface QuestionDetail {
  id: string;
  status: string;
  version: number;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
  createdById: string | null;
  versions: { id: string; version: number; createdAt: string }[];
  [k: string]: unknown;
}

function fromApi(q: QuestionDetail): FormState {
  const s = (v: unknown) => (v == null ? '' : String(v));
  return {
    refId: s(q.refId), type: q.type as FormState['type'], difficulty: q.difficulty as FormState['difficulty'],
    examId: s(q.examId), subjectId: s(q.subjectId), topicId: s(q.topicId), classLevel: s(q.classLevel),
    textEn: s(q.textEn), textHi: s(q.textHi), solutionEn: s(q.solutionEn), solutionHi: s(q.solutionHi),
    imageUrl: s(q.imageUrl), solutionImageUrl: s(q.solutionImageUrl),
    options: ((q.options as { label: Label; textEn: string; textHi: string | null }[]) ?? []).map((o) => ({ label: o.label, textEn: o.textEn, textHi: o.textHi ?? '' })),
    correctLabels: (q.correctLabels as Label[]) ?? [],
    correctNumeric: s(q.correctNumeric), numericTolerance: s(q.numericTolerance),
    marks: s(q.marks), negativeMarks: s(q.negativeMarks), tags: ((q.tags as string[]) ?? []).join(', '),
    source: s(q.source), licence: s(q.licence),
  };
}

function toPayload(f: FormState) {
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  return {
    refId: f.refId || null, type: f.type, difficulty: f.difficulty, examId: f.examId || null, subjectId: f.subjectId,
    topicId: f.topicId || null, classLevel: num(f.classLevel), textEn: f.textEn, textHi: f.textHi || null,
    solutionEn: f.solutionEn || null, solutionHi: f.solutionHi || null, imageUrl: f.imageUrl || null,
    solutionImageUrl: f.solutionImageUrl || null,
    options: f.type === 'NUMERIC' ? [] : f.options.map((o) => ({ label: o.label, textEn: o.textEn, textHi: o.textHi || null })),
    correctLabels: f.type === 'NUMERIC' ? [] : f.correctLabels, correctNumeric: f.type === 'NUMERIC' ? num(f.correctNumeric) : null,
    numericTolerance: f.type === 'NUMERIC' ? num(f.numericTolerance) : null, marks: num(f.marks) ?? 1,
    negativeMarks: num(f.negativeMarks) ?? 0, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
    source: f.source || null, licence: f.licence || null,
  };
}

export function QuestionEditorPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: tax } = useTaxonomy();
  const [f, setF] = useState<FormState>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [previewLang, setPreviewLang] = useState<'EN' | 'HI'>('EN');
  const editable = can('content.write');

  const { data: q } = useQuery({
    queryKey: ['question', id],
    queryFn: () => api<QuestionDetail>(`/v1/admin/questions/${id}`),
    enabled: !isNew,
  });
  useEffect(() => {
    if (q) setF(fromApi(q));
  }, [q]);

  const save = useMutation({
    mutationFn: (payload: ReturnType<typeof toPayload>) =>
      isNew ? api<QuestionDetail>('/v1/admin/questions', { method: 'POST', json: payload }) : api<QuestionDetail>(`/v1/admin/questions/${id}`, { method: 'PUT', json: payload }),
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ['questions'] });
      qc.setQueryData(['question', saved.id], undefined);
      void qc.invalidateQueries({ queryKey: ['question', saved.id] });
      if (isNew) navigate(`/questions/${saved.id}`, { replace: true });
    },
  });

  const review = useMutation({
    mutationFn: (body: { action: string; note?: string }) => api(`/v1/admin/questions/${id}/review`, { method: 'POST', json: body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['question', id] });
      void qc.invalidateQueries({ queryKey: ['questions'] });
    },
  });

  const remove = useMutation({
    mutationFn: () => api(`/v1/admin/questions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['questions'] });
      navigate('/questions');
    },
  });

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));
  const topics = tax?.subjects.find((s) => s.id === f.subjectId)?.topics ?? [];

  function submit() {
    const payload = toPayload(f);
    const parsed = questionSchema.safeParse(payload);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[i.path[0] as string] ??= i.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    save.mutate(payload);
  }

  async function upload(field: 'imageUrl' | 'solutionImageUrl', file: File) {
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await api<{ url: string }>('/v1/admin/questions/images', { method: 'POST', body: fd });
      set(field, r.url);
    } catch (e) {
      window.alert(e instanceof ApiError ? e.message : 'Upload failed');
    }
  }

  function toggleCorrect(label: Label) {
    if (f.type === 'MCQ_SINGLE') set('correctLabels', [label]);
    else set('correctLabels', f.correctLabels.includes(label) ? f.correctLabels.filter((l) => l !== label) : [...f.correctLabels, label]);
  }

  function addOption() {
    const next = OPTION_LABELS[f.options.length];
    if (next) set('options', [...f.options, { label: next, textEn: '', textHi: '' }]);
  }

  function removeOption(idx: number) {
    const remaining = f.options.filter((_, i) => i !== idx).map((o, i) => ({ ...o, label: OPTION_LABELS[i] }));
    setF((p) => ({ ...p, options: remaining, correctLabels: [] }));
  }

  const lang = (en: string, hi: string) => (previewLang === 'HI' && hi ? hi : en);

  return (
    <>
      <Link to="/questions" className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-ink"><ArrowLeft size={14} /> Questions</Link>
      <PageHeader
        title={isNew ? 'New question' : `Edit question`}
        subtitle={q ? `Version ${q.version} · updated ${fmtDate(q.updatedAt)}${q.status === 'APPROVED' ? ' · saving changes sends it back to review' : ''}` : 'Fill English first; Hindi is optional but recommended.'}
        actions={q && <Badge tone={statusTone(q.status)}>{q.status.replace('_', ' ')}</Badge>}
      />
      {q?.reviewNote && <div className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><b>Reviewer note:</b> {q.reviewNote}</div>}

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card title="Classification">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Type">
                <Select value={f.type} onChange={(e) => setF((p) => ({ ...p, type: e.target.value as FormState['type'], correctLabels: [] }))}>
                  <option value="MCQ_SINGLE">MCQ – single answer</option>
                  <option value="MCQ_MULTI">MCQ – multiple answers</option>
                  <option value="NUMERIC">Numeric answer</option>
                </Select>
              </Field>
              <Field label="Difficulty">
                <Select value={f.difficulty} onChange={(e) => set('difficulty', e.target.value as FormState['difficulty'])}>
                  <option>EASY</option><option>MEDIUM</option><option>HARD</option>
                </Select>
              </Field>
              <Field label="Exam" hint="Optional for class-wise questions">
                <Select value={f.examId} onChange={(e) => set('examId', e.target.value)}>
                  <option value="">—</option>
                  {tax?.exams.map((e) => <option key={e.id} value={e.id}>{e.nameEn}</option>)}
                </Select>
              </Field>
              <Field label="Class">
                <Select value={f.classLevel} onChange={(e) => set('classLevel', e.target.value)}>
                  <option value="">—</option>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((c) => <option key={c} value={c}>Class {c}</option>)}
                </Select>
              </Field>
              <Field label="Subject" error={errors.subjectId}>
                <Select value={f.subjectId} onChange={(e) => setF((p) => ({ ...p, subjectId: e.target.value, topicId: '' }))}>
                  <option value="">Select…</option>
                  {tax?.subjects.map((s) => <option key={s.id} value={s.id}>{s.nameEn}</option>)}
                </Select>
              </Field>
              <Field label="Topic">
                <Select value={f.topicId} onChange={(e) => set('topicId', e.target.value)} disabled={!topics.length}>
                  <option value="">—</option>
                  {topics.map((t) => <option key={t.id} value={t.id}>{t.nameEn}</option>)}
                </Select>
              </Field>
              <Field label="ref_id" hint="Your own unique ID">
                <Input value={f.refId} onChange={(e) => set('refId', e.target.value)} placeholder="SSC-QA-0001" />
              </Field>
              <Field label="Tags" hint="Comma separated">
                <Input value={f.tags} onChange={(e) => set('tags', e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card title="Question">
            <p className="mb-3 text-xs text-gray-500">Use <code className="rounded bg-gray-100 px-1">$...$</code> for maths, e.g. <code className="rounded bg-gray-100 px-1">$x^2 + \frac{'{1}{2}'}$</code></p>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="English" error={errors.textEn}>
                <Textarea rows={5} value={f.textEn} onChange={(e) => set('textEn', e.target.value)} />
              </Field>
              <Field label="हिन्दी (Hindi)">
                <Textarea rows={5} className="hindi" value={f.textHi} onChange={(e) => set('textHi', e.target.value)} />
              </Field>
            </div>
            <ImageField label="Question image" url={f.imageUrl} onUpload={(file) => upload('imageUrl', file)} onClear={() => set('imageUrl', '')} />
          </Card>

          <Card title={f.type === 'NUMERIC' ? 'Answer' : 'Options'}>
            {f.type === 'NUMERIC' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Correct value" error={errors.correctNumeric}>
                  <Input type="number" step="any" value={f.correctNumeric} onChange={(e) => set('correctNumeric', e.target.value)} />
                </Field>
                <Field label="Tolerance (±)" hint="Blank = exact match">
                  <Input type="number" step="any" min={0} value={f.numericTolerance} onChange={(e) => set('numericTolerance', e.target.value)} />
                </Field>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">{f.type === 'MCQ_SINGLE' ? 'Tick the one correct option.' : 'Tick every correct option.'}</p>
                {f.options.map((o, idx) => (
                  <div key={o.label} className={cx('grid items-start gap-3 rounded-xl border p-3 md:grid-cols-[auto_1fr_1fr_auto]', f.correctLabels.includes(o.label) ? 'border-emerald-300 bg-emerald-50/50' : 'border-gray-100')}>
                    <button
                      type="button"
                      onClick={() => toggleCorrect(o.label)}
                      className={cx('flex h-9 w-9 items-center justify-center rounded-lg text-sm font-extrabold', f.correctLabels.includes(o.label) ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-600')}
                      title="Mark as correct"
                    >
                      {o.label}
                    </button>
                    <Input placeholder="English" value={o.textEn} onChange={(e) => set('options', f.options.map((x, i) => (i === idx ? { ...x, textEn: e.target.value } : x)))} />
                    <Input placeholder="हिन्दी" className="hindi" value={o.textHi} onChange={(e) => set('options', f.options.map((x, i) => (i === idx ? { ...x, textHi: e.target.value } : x)))} />
                    <button type="button" onClick={() => removeOption(idx)} disabled={f.options.length <= 2} className="p-2 text-gray-400 hover:text-red-600 disabled:opacity-30" aria-label="Remove option">
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                {(errors.options || errors.correctLabels) && <p className="text-xs text-red-600">{errors.options ?? errors.correctLabels}</p>}
                {f.options.length < 6 && <Button variant="secondary" size="sm" onClick={addOption}><Plus size={14} /> Add option</Button>}
              </div>
            )}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Marks"><Input type="number" step="0.25" min={0} value={f.marks} onChange={(e) => set('marks', e.target.value)} /></Field>
              <Field label="Negative marks"><Input type="number" step="0.25" min={0} value={f.negativeMarks} onChange={(e) => set('negativeMarks', e.target.value)} /></Field>
            </div>
          </Card>

          <Card title="Solution (optional)">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="English"><Textarea rows={4} value={f.solutionEn} onChange={(e) => set('solutionEn', e.target.value)} /></Field>
              <Field label="हिन्दी (Hindi)"><Textarea rows={4} className="hindi" value={f.solutionHi} onChange={(e) => set('solutionHi', e.target.value)} /></Field>
            </div>
            <ImageField label="Solution image" url={f.solutionImageUrl} onUpload={(file) => upload('solutionImageUrl', file)} onClear={() => set('solutionImageUrl', '')} />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Source"><Input value={f.source} onChange={(e) => set('source', e.target.value)} placeholder="In-house, publisher, PYQ 2023…" /></Field>
              <Field label="Licence / copyright"><Input value={f.licence} onChange={(e) => set('licence', e.target.value)} /></Field>
            </div>
          </Card>

          <ErrorBox error={save.error} />
          {editable && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={submit} disabled={save.isPending}>{save.isPending ? 'Saving…' : isNew ? 'Create draft' : 'Save changes'}</Button>
              {!isNew && q && ['DRAFT', 'REJECTED'].includes(q.status) && (
                <Button variant="ghost" className="text-red-600" onClick={() => window.confirm('Delete this question permanently?') && remove.mutate()}>Delete</Button>
              )}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Student preview" actions={
            <div className="flex rounded-lg bg-gray-100 p-0.5 text-xs font-semibold">
              {(['EN', 'HI'] as const).map((l) => (
                <button key={l} onClick={() => setPreviewLang(l)} className={cx('rounded-md px-2 py-1', previewLang === l && 'bg-white shadow')}>{l === 'EN' ? 'English' : 'हिन्दी'}</button>
              ))}
            </div>
          }>
            <div className="rounded-2xl bg-arena p-3">
              <div className="rounded-xl bg-white p-4">
                <p className={cx('text-sm font-semibold leading-relaxed', previewLang === 'HI' && 'hindi')}>
                  {f.textEn ? <MathText text={lang(f.textEn, f.textHi)} /> : <span className="text-gray-400">Question text…</span>}
                </p>
                {f.imageUrl && <img src={f.imageUrl} alt="" className="mt-3 max-h-40 rounded-lg" />}
                {f.type !== 'NUMERIC' ? (
                  <div className="mt-4 space-y-2">
                    {f.options.map((o) => (
                      <div key={o.label} className="flex items-center gap-3 rounded-xl border border-gray-100 p-2.5 text-sm">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 text-xs font-bold">{o.label}</span>
                        <span className={previewLang === 'HI' ? 'hindi' : ''}><MathText text={lang(o.textEn, o.textHi)} /></span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-dashed border-gray-200 p-3 text-sm text-gray-400">Numeric answer box</div>
                )}
              </div>
            </div>
            {previewLang === 'HI' && !f.textHi && <p className="mt-2 text-xs text-amber-600">No Hindi text — students will see English.</p>}
          </Card>

          {q && editable && (
            <Card title="Review">
              <ErrorBox error={review.error} />
              <div className="mt-2 flex flex-wrap gap-2">
                {['DRAFT', 'REJECTED'].includes(q.status) && <Button size="sm" onClick={() => review.mutate({ action: 'SUBMIT' })}>Submit for review</Button>}
                {can('content.review') && ['IN_REVIEW', 'DRAFT'].includes(q.status) && <Button size="sm" onClick={() => review.mutate({ action: 'APPROVE' })}>Approve</Button>}
                {can('content.review') && q.status === 'IN_REVIEW' && (
                  <Button size="sm" variant="secondary" onClick={() => {
                    const note = window.prompt('Reason for rejection');
                    if (note) review.mutate({ action: 'REJECT', note });
                  }}>Reject</Button>
                )}
                {can('content.review') && q.status === 'APPROVED' && <Button size="sm" variant="secondary" onClick={() => review.mutate({ action: 'RETIRE' })}>Retire</Button>}
                {['RETIRED', 'REJECTED'].includes(q.status) && <Button size="sm" variant="secondary" onClick={() => review.mutate({ action: 'REOPEN' })}>Reopen as draft</Button>}
              </div>
              <p className="mt-3 text-xs text-gray-400">Authors cannot approve their own questions (super admins excepted).</p>
            </Card>
          )}

          {q && q.versions.length > 0 && (
            <Card title="Version history">
              <ul className="space-y-2 text-sm">
                <li className="flex justify-between"><span className="font-semibold">v{q.version} (current)</span><span className="text-gray-400">{fmtDate(q.updatedAt)}</span></li>
                {q.versions.map((v) => (
                  <li key={v.id} className="flex justify-between text-gray-600"><span>v{v.version}</span><span className="text-gray-400">{fmtDate(v.createdAt)}</span></li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function ImageField({ label, url, onUpload, onClear }: { label: string; url: string; onUpload: (f: File) => void; onClear: () => void }) {
  return (
    <div className="mt-4 flex items-center gap-3">
      {url ? (
        <>
          <img src={url} alt="" className="h-16 rounded-lg border border-gray-100" />
          <Button variant="ghost" size="sm" onClick={onClear}>Remove</Button>
        </>
      ) : (
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-gray-300 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50">
          <ImagePlus size={14} /> {label}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
        </label>
      )}
    </div>
  );
}
