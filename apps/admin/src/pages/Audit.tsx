import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, fmtDate, Modal, PageHeader, Pager, Select, Table } from '../components/ui';
import { api } from '../lib/api';

interface AuditRow {
  id: string;
  actorType: string;
  actorId: string | null;
  actor: { name: string; email: string } | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  meta: unknown;
  ip: string | null;
  createdAt: string;
}

const ENTITIES = ['', 'Question', 'ImportBatch', 'Tournament', 'Banner', 'HomeSection', 'AppConfig', 'User', 'AdminUser', 'Exam', 'Subject', 'Topic'];

export function AuditPage() {
  const [entityType, setEntityType] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AuditRow | null>(null);
  const { data } = useQuery({
    queryKey: ['audit', entityType, page],
    queryFn: () => api<{ items: AuditRow[]; total: number; page: number; pageSize: number }>(`/v1/admin/audit?${new URLSearchParams({ ...(entityType && { entityType }), page: String(page), pageSize: '30' })}`),
  });
  return (
    <>
      <PageHeader title="Audit log" subtitle="Append-only record of every admin, system and sign-up action. The database rejects edits and deletions." />
      <Select value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }} className="mb-4 max-w-xs">
        {ENTITIES.map((e) => <option key={e} value={e}>{e || 'All entities'}</option>)}
      </Select>
      <Table head={['When', 'Who', 'Action', 'Entity', '']}>
        {data?.items.map((a) => (
          <tr key={a.id}>
            <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{fmtDate(a.createdAt)}</td>
            <td className="px-4 py-3 text-xs">{a.actor ? a.actor.name : <Badge>{a.actorType}</Badge>}{a.ip && <span className="block text-gray-400">{a.ip}</span>}</td>
            <td className="px-4 py-3 font-mono text-xs">{a.action}</td>
            <td className="px-4 py-3 text-xs">{a.entityType}<span className="block text-gray-400">{a.entityId}</span></td>
            <td className="px-4 py-3 text-right">{(a.before != null || a.after != null || a.meta != null) && <Button size="sm" variant="ghost" onClick={() => setOpen(a)}>Details</Button>}</td>
          </tr>
        ))}
      </Table>
      {data && <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      {open && (
        <Modal open onClose={() => setOpen(null)} title={open.action} wide>
          <div className="grid gap-4 md:grid-cols-2">
            {(['before', 'after'] as const).map((k) => (
              <div key={k}>
                <p className="mb-1 text-xs font-bold uppercase text-gray-500">{k}</p>
                <pre className="max-h-96 overflow-auto rounded-xl bg-gray-50 p-3 text-[11px]">{open[k] == null ? '—' : JSON.stringify(open[k], null, 2)}</pre>
              </div>
            ))}
          </div>
          {open.meta != null && <pre className="mt-4 rounded-xl bg-gray-50 p-3 text-[11px]">{JSON.stringify(open.meta, null, 2)}</pre>}
        </Modal>
      )}
    </>
  );
}
