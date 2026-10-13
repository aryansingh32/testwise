import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, Toggle } from '../components/ui';
import { api, can } from '../lib/api';
import { useTaxonomy, type Exam, type Subject } from '../lib/hooks';

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export function TaxonomyPage() {
  const { data } = useTaxonomy();
  const qc = useQueryClient();
  const [examModal, setExamModal] = useState<Partial<Exam> | null>(null);
  const [subjectModal, setSubjectModal] = useState<Partial<Subject> | null>(null);
  const [topicFor, setTopicFor] = useState<Subject | null>(null);
  const writable = can('content.write');
  const refresh = () => qc.invalidateQueries({ queryKey: ['taxonomy'] });

  const delTopic = useMutation({ mutationFn: (id: string) => api(`/v1/admin/taxonomy/topics/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const delSubject = useMutation({ mutationFn: (id: string) => api(`/v1/admin/taxonomy/subjects/${id}`, { method: 'DELETE' }), onSuccess: refresh });

  return (
    <>
      <PageHeader title="Exams & subjects" subtitle="The taxonomy used by questions, bulk upload, tournaments and the app's exam picker." />
      <ErrorBox error={delTopic.error ?? delSubject.error} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Exams & classes" actions={writable && <Button size="sm" onClick={() => setExamModal({ category: 'COMPETITIVE', color: '#F59E0B', icon: 'book', active: true, sortOrder: (data?.exams.length ?? 0) })}><Plus size={14} /> Exam</Button>}>
          <ul className="divide-y divide-gray-50">
            {data?.exams.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-3">
                <span className="h-8 w-8 shrink-0 rounded-lg" style={{ background: e.color }} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{e.nameEn} <span className="hindi font-normal text-gray-500">{e.nameHi}</span></p>
                  <p className="text-xs text-gray-400">{e.slug} · {e._count?.questions ?? 0} questions</p>
                </div>
                <Badge tone={e.category === 'SCHOOL' ? 'blue' : 'amber'}>{e.category}</Badge>
                {!e.active && <Badge>hidden</Badge>}
                {writable && <button onClick={() => setExamModal(e)} className="p-1 text-gray-400 hover:text-ink" aria-label="Edit"><Pencil size={14} /></button>}
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Subjects & topics" actions={writable && <Button size="sm" onClick={() => setSubjectModal({})}><Plus size={14} /> Subject</Button>}>
          <ul className="divide-y divide-gray-50">
            {data?.subjects.map((s) => (
              <li key={s.id} className="py-3">
                <div className="flex items-center gap-2">
                  <p className="flex-1 font-semibold">{s.nameEn} <span className="hindi font-normal text-gray-500">{s.nameHi}</span> <span className="text-xs font-normal text-gray-400">· {s._count?.questions ?? 0} questions</span></p>
                  {writable && (
                    <>
                      <button onClick={() => setSubjectModal(s)} className="p-1 text-gray-400 hover:text-ink" aria-label="Edit"><Pencil size={14} /></button>
                      <button onClick={() => window.confirm(`Delete subject ${s.nameEn}?`) && delSubject.mutate(s.id)} className="p-1 text-gray-400 hover:text-red-600" aria-label="Delete"><Trash2 size={14} /></button>
                    </>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {s.topics.map((t) => (
                    <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs">
                      {t.nameEn}
                      {writable && <button onClick={() => window.confirm(`Delete topic ${t.nameEn}?`) && delTopic.mutate(t.id)} className="text-gray-400 hover:text-red-600" aria-label="Delete topic">×</button>}
                    </span>
                  ))}
                  {writable && <button onClick={() => setTopicFor(s)} className="rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-50">+ topic</button>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {examModal && <ExamForm initial={examModal} onClose={() => setExamModal(null)} onSaved={refresh} />}
      {subjectModal && <NameForm title={subjectModal.id ? 'Edit subject' : 'New subject'} initial={subjectModal} path={subjectModal.id ? `/v1/admin/taxonomy/subjects/${subjectModal.id}` : '/v1/admin/taxonomy/subjects'} method={subjectModal.id ? 'PUT' : 'POST'} onClose={() => setSubjectModal(null)} onSaved={refresh} />}
      {topicFor && <NameForm title={`New topic in ${topicFor.nameEn}`} initial={{}} extra={{ subjectId: topicFor.id }} path="/v1/admin/taxonomy/topics" method="POST" onClose={() => setTopicFor(null)} onSaved={refresh} />}
    </>
  );
}

function ExamForm({ initial, onClose, onSaved }: { initial: Partial<Exam>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ slug: '', nameEn: '', nameHi: '', category: 'COMPETITIVE', icon: 'book', color: '#F59E0B', sortOrder: 0, active: true, ...initial });
  const save = useMutation({
    mutationFn: () =>
      api(initial.id ? `/v1/admin/taxonomy/exams/${initial.id}` : '/v1/admin/taxonomy/exams', {
        method: initial.id ? 'PUT' : 'POST',
        json: { slug: f.slug, nameEn: f.nameEn, nameHi: f.nameHi || null, category: f.category, icon: f.icon, color: f.color, sortOrder: Number(f.sortOrder), active: f.active },
      }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={initial.id ? 'Edit exam' : 'New exam'}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name (English)"><Input value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value, slug: initial.id ? f.slug : slugify(e.target.value) })} /></Field>
        <Field label="नाम (Hindi)"><Input className="hindi" value={f.nameHi ?? ''} onChange={(e) => setF({ ...f, nameHi: e.target.value })} /></Field>
        <Field label="Slug" hint="Used in bulk upload sheets"><Input value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} /></Field>
        <Field label="Category">
          <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as Exam['category'] })}>
            <option value="COMPETITIVE">Competitive exam</option>
            <option value="SCHOOL">School / class</option>
          </Select>
        </Field>
        <Field label="Colour"><Input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className="h-10 p-1" /></Field>
        <Field label="Sort order"><Input type="number" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: Number(e.target.value) })} /></Field>
        <Field label="Icon key" hint="briefcase, landmark, atom, school…"><Input value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })} /></Field>
        <div className="flex items-end pb-2"><Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Visible in app" /></div>
      </div>
      <div className="mt-4"><ErrorBox error={save.error} /></div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
      </div>
    </Modal>
  );
}

function NameForm({ title, initial, extra, path, method, onClose, onSaved }: { title: string; initial: { slug?: string; nameEn?: string; nameHi?: string | null; id?: string }; extra?: Record<string, string>; path: string; method: 'POST' | 'PUT'; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ slug: initial.slug ?? '', nameEn: initial.nameEn ?? '', nameHi: initial.nameHi ?? '' });
  const save = useMutation({
    mutationFn: () => api(path, { method, json: { ...f, nameHi: f.nameHi || null, ...extra } }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={title}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name (English)"><Input value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value, slug: initial.id ? f.slug : slugify(e.target.value) })} /></Field>
        <Field label="नाम (Hindi)"><Input className="hindi" value={f.nameHi} onChange={(e) => setF({ ...f, nameHi: e.target.value })} /></Field>
        <Field label="Slug" hint="Used in bulk upload sheets" className="sm:col-span-2"><Input value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} /></Field>
      </div>
      <div className="mt-4"><ErrorBox error={save.error} /></div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
      </div>
    </Modal>
  );
}
