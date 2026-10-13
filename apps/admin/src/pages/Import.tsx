import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, FileSpreadsheet, FileArchive, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Badge, Button, Card, Empty, ErrorBox, fmtDate, PageHeader, statusTone, Table } from '../components/ui';
import { api, download } from '../lib/api';

interface ValidationResult {
  id: string;
  fileName: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  creates: number;
  updates: number;
  newTopics: string[];
  errors: { row: number; refId?: string; messages: string[] }[];
  preview: { row: number; refId: string | null; type: string; difficulty: string; textEn: string; hasHindi: boolean; action: string }[];
}

interface Batch {
  id: string;
  fileName: string;
  status: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  importedAt: string | null;
  createdAt: string;
}

export function ImportPage() {
  const qc = useQueryClient();
  const [sheet, setSheet] = useState<File | null>(null);
  const [zip, setZip] = useState<File | null>(null);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [done, setDone] = useState<{ created: number; updated: number } | null>(null);

  const batches = useQuery({ queryKey: ['imports'], queryFn: () => api<Batch[]>('/v1/admin/questions/import') });

  const validate = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('file', sheet!);
      if (zip) fd.append('images', zip);
      return api<ValidationResult>('/v1/admin/questions/import/validate', { method: 'POST', body: fd });
    },
    onSuccess: (r) => {
      setResult(r);
      setDone(null);
      void qc.invalidateQueries({ queryKey: ['imports'] });
    },
  });

  const commit = useMutation({
    mutationFn: (id: string) => api<{ created: number; updated: number }>(`/v1/admin/questions/import/${id}/commit`, { method: 'POST' }),
    onSuccess: (r) => {
      setDone(r);
      void qc.invalidateQueries({ queryKey: ['imports'] });
      void qc.invalidateQueries({ queryKey: ['questions'] });
      void qc.invalidateQueries({ queryKey: ['taxonomy'] });
    },
  });

  const rollback = useMutation({
    mutationFn: (id: string) => api(`/v1/admin/questions/import/${id}/rollback`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['imports'] });
      void qc.invalidateQueries({ queryKey: ['questions'] });
    },
  });

  return (
    <>
      <PageHeader title="Bulk upload questions" subtitle="Download the template, fill one question per row, then upload. Nothing is saved until you confirm the preview." />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="1. Get the template">
          <p className="mb-4 text-sm text-gray-600">The Excel template has dropdowns for exam, subject, difficulty and type, plus an Instructions sheet explaining every column.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => download('/v1/admin/questions/import/template?format=xlsx', 'testwise-questions-template.xlsx')}>
              <Download size={16} /> Excel (.xlsx)
            </Button>
            <Button variant="secondary" onClick={() => download('/v1/admin/questions/import/template?format=csv', 'testwise-questions-template.csv')}>
              <Download size={16} /> CSV
            </Button>
          </div>
          <p className="mt-4 text-xs text-gray-400">Subjects must exist first (Exams &amp; subjects). New topics are created automatically.</p>
        </Card>

        <Card title="2. Upload" className="lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <FilePick icon={FileSpreadsheet} label="Question sheet" hint=".xlsx or .csv, up to 5,000 rows" accept=".xlsx,.csv" file={sheet} onPick={setSheet} />
            <FilePick icon={FileArchive} label="Images (optional)" hint=".zip with files named in question_image / solution_image" accept=".zip" file={zip} onPick={setZip} />
          </div>
          <div className="mt-4">
            <Button disabled={!sheet || validate.isPending} onClick={() => validate.mutate()}>
              {validate.isPending ? 'Checking every row…' : 'Check file'}
            </Button>
          </div>
          <div className="mt-3"><ErrorBox error={validate.error} /></div>
        </Card>
      </div>

      {result && (
        <Card className="mt-6" title={`3. Review — ${result.fileName}`}>
          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            <Summary label="Rows" value={result.totalRows} />
            <Summary label="Ready to import" value={result.validRows} tone="text-emerald-600" />
            <Summary label="With errors" value={result.errorRows} tone={result.errorRows ? 'text-red-600' : undefined} />
            <Summary label="New / updated" value={`${result.creates} / ${result.updates}`} />
          </div>
          {result.newTopics.length > 0 && (
            <p className="mb-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-800">New topics will be created: {result.newTopics.join(', ')}</p>
          )}

          {result.errors.length > 0 && (
            <div className="mb-6">
              <h3 className="mb-2 text-sm font-bold text-red-700">Rows with errors (not imported)</h3>
              <Table head={['Row', 'ref_id', 'Problems']}>
                {result.errors.map((e) => (
                  <tr key={e.row}>
                    <td className="px-4 py-2 font-mono text-xs">{e.row}</td>
                    <td className="px-4 py-2 text-xs">{e.refId ?? '—'}</td>
                    <td className="px-4 py-2 text-xs text-red-700">{e.messages.join(' · ')}</td>
                  </tr>
                ))}
              </Table>
            </div>
          )}

          {result.preview.length > 0 && (
            <>
              <h3 className="mb-2 text-sm font-bold">Preview (first {result.preview.length} valid rows)</h3>
              <Table head={['Row', 'Action', 'Question', 'Type', 'Hindi']}>
                {result.preview.map((p) => (
                  <tr key={p.row}>
                    <td className="px-4 py-2 font-mono text-xs">{p.row}</td>
                    <td className="px-4 py-2"><Badge tone={p.action === 'create' ? 'green' : 'blue'}>{p.action}</Badge></td>
                    <td className="max-w-md truncate px-4 py-2 text-sm">{p.textEn}</td>
                    <td className="px-4 py-2 text-xs">{p.type} · {p.difficulty}</td>
                    <td className="px-4 py-2 text-xs">{p.hasHindi ? '✓' : '—'}</td>
                  </tr>
                ))}
              </Table>
            </>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {done ? (
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                <CheckCircle2 size={18} /> Imported {done.created} new and updated {done.updated} questions as Draft.{' '}
                <Link className="underline" to={`/questions?importBatchId=${result.id}`}>Review them</Link>
              </p>
            ) : (
              <>
                <Button disabled={!result.validRows || commit.isPending} onClick={() => commit.mutate(result.id)}>
                  {commit.isPending ? 'Importing…' : result.errorRows ? `Import ${result.validRows} valid rows` : `Import all ${result.validRows} rows`}
                </Button>
                {result.errorRows > 0 && <span className="text-sm text-gray-500">or fix the errors in your sheet and upload again.</span>}
              </>
            )}
          </div>
          <div className="mt-3"><ErrorBox error={commit.error} /></div>
        </Card>
      )}

      <h2 className="mb-3 mt-10 text-lg font-bold">Upload history</h2>
      <ErrorBox error={rollback.error} />
      {batches.data?.length ? (
        <Table head={['File', 'Status', 'Rows', 'Uploaded', '']}>
          {batches.data.map((b) => (
            <tr key={b.id}>
              <td className="px-4 py-3 font-medium">{b.fileName}</td>
              <td className="px-4 py-3"><Badge tone={statusTone(b.status)}>{b.status.replace('_', ' ')}</Badge></td>
              <td className="px-4 py-3 text-xs text-gray-600">{b.validRows} valid · {b.errorRows} errors</td>
              <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(b.createdAt)}</td>
              <td className="px-4 py-3 text-right">
                {b.status === 'IMPORTED' && (
                  <div className="flex justify-end gap-2">
                    <Link to={`/questions?importBatchId=${b.id}`}><Button size="sm" variant="secondary">View</Button></Link>
                    <Button size="sm" variant="ghost" onClick={() => window.confirm('Undo this upload? Questions it created are deleted and updated ones restored. Blocked if any were reviewed since.') && rollback.mutate(b.id)}>
                      <Undo2 size={14} /> Undo
                    </Button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <Empty>No uploads yet.</Empty>
      )}
    </>
  );
}

function Summary({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-xl bg-gray-50 p-3">
      <p className="text-xs font-semibold text-gray-500">{label}</p>
      <p className={`text-2xl font-extrabold tabular-nums ${tone ?? ''}`}>{value}</p>
    </div>
  );
}

function FilePick({ icon: Icon, label, hint, accept, file, onPick }: { icon: typeof FileSpreadsheet; label: string; hint: string; accept: string; file: File | null; onPick: (f: File | null) => void }) {
  return (
    <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 p-6 text-center hover:border-brand-500 hover:bg-brand-50/40">
      <Icon size={28} className="text-brand-500" />
      <span className="mt-2 text-sm font-semibold">{file ? file.name : label}</span>
      <span className="mt-1 text-xs text-gray-400">{file ? `${(file.size / 1024).toFixed(0)} KB · click to change` : hint}</span>
      <input type="file" accept={accept} className="hidden" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
    </label>
  );
}
