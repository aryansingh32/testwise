import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Badge, Button, Empty, fmtDate, Input, PageHeader, Select, statusTone, Table } from '../components/ui';
import { api, can } from '../lib/api';

interface TestRow {
  id: string;
  titleEn: string;
  kind: string;
  status: string;
  durationMinutes: number;
  updatedAt: string;
  exam: { nameEn: string } | null;
  _count: { questions: number; attempts: number };
}

export function TestsPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['tests', status, kind, q],
    queryFn: () => api<TestRow[]>(`/v1/admin/tests?${new URLSearchParams({ ...(status && { status }), ...(kind && { kind }), ...(q && { q }) })}`),
  });
  return (
    <>
      <PageHeader
        title="Tests"
        subtitle="Papers built from approved questions. Use them in test series (practice) or attach them to tournaments."
        actions={can('content.write') && <Link to="/tests/new"><Button><Plus size={16} /> New test</Button></Link>}
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input placeholder="Search title — press Enter" className="max-w-xs" onKeyDown={(e) => e.key === 'Enter' && setQ(e.currentTarget.value)} />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[180px]">
          <option value="">All statuses</option>
          {['DRAFT', 'PUBLISHED', 'ARCHIVED'].map((s) => <option key={s}>{s}</option>)}
        </Select>
        <Select value={kind} onChange={(e) => setKind(e.target.value)} className="max-w-[200px]">
          <option value="">All kinds</option>
          {['MOCK', 'SECTIONAL', 'PRACTICE', 'PREVIOUS_YEAR', 'TOURNAMENT'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </Select>
      </div>
      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : !data?.length ? (
        <Empty>No tests yet. Build one from your approved questions.</Empty>
      ) : (
        <Table head={['Test', 'Kind', 'Status', 'Questions', 'Attempts', 'Updated']}>
          {data.map((t) => (
            <tr key={t.id} className="cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/tests/${t.id}`)}>
              <td className="px-4 py-3"><p className="font-semibold">{t.titleEn}</p><p className="text-xs text-gray-400">{t.exam?.nameEn ?? 'Any exam'} · {t.durationMinutes} min</p></td>
              <td className="px-4 py-3 text-xs">{t.kind.replace('_', ' ')}</td>
              <td className="px-4 py-3"><Badge tone={statusTone(t.status === 'PUBLISHED' ? 'APPROVED' : t.status === 'ARCHIVED' ? 'RETIRED' : 'DRAFT')}>{t.status}</Badge></td>
              <td className="px-4 py-3 text-xs tabular-nums">{t._count.questions}</td>
              <td className="px-4 py-3 text-xs tabular-nums">{t._count.attempts}</td>
              <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(t.updatedAt)}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
