import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { MathText } from '../components/MathText';
import { Badge, Button, Empty, ErrorBox, Input, PageHeader, Pager, Select, statusTone, Table } from '../components/ui';
import { api, can } from '../lib/api';
import { useTaxonomy } from '../lib/hooks';

export interface QuestionRow {
  id: string;
  refId: string | null;
  type: string;
  difficulty: string;
  status: string;
  textEn: string;
  textHi: string | null;
  version: number;
  updatedAt: string;
  exam: { nameEn: string } | null;
  subject: { nameEn: string };
  topic: { nameEn: string } | null;
}

const ACTIONS = [
  { action: 'SUBMIT', label: 'Submit for review' },
  { action: 'APPROVE', label: 'Approve' },
  { action: 'REJECT', label: 'Reject' },
  { action: 'RETIRE', label: 'Retire' },
] as const;

export function QuestionsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: tax } = useTaxonomy();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const filters = Object.fromEntries(params.entries());
  const page = Number(filters.page ?? 1);

  const { data, isLoading } = useQuery({
    queryKey: ['questions', filters],
    queryFn: () => api<{ items: QuestionRow[]; total: number; page: number; pageSize: number }>(`/v1/admin/questions?${params.toString()}`),
  });

  const bulk = useMutation({
    mutationFn: ({ action, note }: { action: string; note?: string }) =>
      api<{ ok: number; failed: { id: string; error: string }[] }>('/v1/admin/questions/review', {
        method: 'POST',
        json: { ids: [...selected], action, note },
      }),
    onSuccess: (r) => {
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ['questions'] });
      if (r.failed.length) alertFailures(r.failed);
    },
  });

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
    setSelected(new Set());
  }

  const items = data?.items ?? [];
  const subjectTopics = tax?.subjects.find((s) => s.id === filters.subjectId)?.topics ?? [];
  const allChecked = items.length > 0 && items.every((i) => selected.has(i.id));

  return (
    <>
      <PageHeader
        title="Questions"
        subtitle="Every question in English and Hindi. New and imported questions start as Draft and need review before use."
        actions={
          can('content.write') && (
            <>
              <Link to="/questions/import">
                <Button variant="secondary"><FileUp size={16} /> Bulk upload</Button>
              </Link>
              <Link to="/questions/new">
                <Button><Plus size={16} /> New question</Button>
              </Link>
            </>
          )
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Input placeholder="Search text, ref_id or tag" defaultValue={filters.q} onKeyDown={(e) => e.key === 'Enter' && setFilter('q', e.currentTarget.value)} className="lg:col-span-2" />
        <Select value={filters.status ?? ''} onChange={(e) => setFilter('status', e.target.value)}>
          <option value="">All statuses</option>
          {['DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'RETIRED'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </Select>
        <Select value={filters.examId ?? ''} onChange={(e) => setFilter('examId', e.target.value)}>
          <option value="">All exams</option>
          {tax?.exams.map((e) => <option key={e.id} value={e.id}>{e.nameEn}</option>)}
        </Select>
        <Select value={filters.subjectId ?? ''} onChange={(e) => { setFilter('subjectId', e.target.value); }}>
          <option value="">All subjects</option>
          {tax?.subjects.map((s) => <option key={s.id} value={s.id}>{s.nameEn}</option>)}
        </Select>
        <Select value={filters.difficulty ?? ''} onChange={(e) => setFilter('difficulty', e.target.value)}>
          <option value="">Any difficulty</option>
          {['EASY', 'MEDIUM', 'HARD'].map((d) => <option key={d} value={d}>{d}</option>)}
        </Select>
        {subjectTopics.length > 0 && (
          <Select value={filters.topicId ?? ''} onChange={(e) => setFilter('topicId', e.target.value)}>
            <option value="">All topics</option>
            {subjectTopics.map((t) => <option key={t.id} value={t.id}>{t.nameEn}</option>)}
          </Select>
        )}
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={filters.missingHindi === 'true'} onChange={(e) => setFilter('missingHindi', e.target.checked ? 'true' : '')} />
          Missing Hindi only
        </label>
      </div>

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-brand-50 p-3 text-sm">
          <span className="font-semibold">{selected.size} selected</span>
          {ACTIONS.filter((a) => a.action === 'SUBMIT' || can('content.review')).map((a) => (
            <Button
              key={a.action}
              size="sm"
              variant={a.action === 'REJECT' || a.action === 'RETIRE' ? 'secondary' : 'primary'}
              disabled={bulk.isPending}
              onClick={() => {
                const note = a.action === 'REJECT' ? window.prompt('Reason for rejection (shown to the author)') ?? undefined : undefined;
                if (a.action === 'REJECT' && !note) return;
                bulk.mutate({ action: a.action, note });
              }}
            >
              {a.label}
            </Button>
          ))}
        </div>
      )}
      <ErrorBox error={bulk.error} />

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : items.length === 0 ? (
        <Empty>No questions match these filters.</Empty>
      ) : (
        <Table
          head={[
            <input key="all" type="checkbox" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(items.map((i) => i.id)))} aria-label="Select all" />,
            'Question', 'Classification', 'Type', 'Status', 'Lang',
          ]}
        >
          {items.map((q) => (
            <tr key={q.id} className="cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/questions/${q.id}`)}>
              <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selected.has(q.id)}
                  onChange={() => {
                    const next = new Set(selected);
                    if (next.has(q.id)) next.delete(q.id);
                    else next.add(q.id);
                    setSelected(next);
                  }}
                  aria-label="Select question"
                />
              </td>
              <td className="max-w-md px-4 py-3">
                <p className="line-clamp-2 font-medium"><MathText text={q.textEn} /></p>
                <p className="mt-0.5 text-xs text-gray-400">{q.refId ?? 'no ref_id'} · v{q.version}</p>
              </td>
              <td className="px-4 py-3 text-xs text-gray-600">
                {[q.exam?.nameEn, q.subject.nameEn, q.topic?.nameEn].filter(Boolean).join(' › ')}
                <div className="mt-0.5 text-gray-400">{q.difficulty}</div>
              </td>
              <td className="px-4 py-3 text-xs">{q.type.replace('MCQ_', 'MCQ ')}</td>
              <td className="px-4 py-3"><Badge tone={statusTone(q.status)}>{q.status.replace('_', ' ')}</Badge></td>
              <td className="px-4 py-3 text-xs">{q.textHi ? 'EN · HI' : <span className="text-amber-600">EN only</span>}</td>
            </tr>
          ))}
        </Table>
      )}
      {data && <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={(p) => setFilter('page', String(p))} />}
    </>
  );
}

function alertFailures(failed: { id: string; error: string }[]) {
  const msg = failed.slice(0, 10).map((f) => `• ${f.error}`).join('\n');
  window.alert(`${failed.length} question(s) were not changed:\n${msg}`);
}
