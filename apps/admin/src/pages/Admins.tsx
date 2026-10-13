import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROLE_PERMISSIONS, type AdminRole } from '@testwise/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, ErrorBox, Field, fmtDate, Input, Modal, PageHeader, Select, Table } from '../components/ui';
import { api, getSession } from '../lib/api';

interface AdminRow { id: string; email: string; name: string; role: AdminRole; active: boolean; lastLoginAt: string | null; createdAt: string }

const ROLES = Object.keys(ROLE_PERMISSIONS) as AdminRole[];

export function AdminsPage() {
  const qc = useQueryClient();
  const me = getSession()?.admin.id;
  const [creating, setCreating] = useState(false);
  const { data } = useQuery({ queryKey: ['admins'], queryFn: () => api<AdminRow[]>('/v1/admin/admins') });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; active?: boolean; role?: AdminRole }) => api(`/v1/admin/admins/${id}`, { method: 'PATCH', json: body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admins'] }),
  });
  return (
    <>
      <PageHeader title="Admins & roles" subtitle="Least-privilege roles. Disabling an admin signs them out everywhere." actions={<Button onClick={() => setCreating(true)}><Plus size={16} /> Add admin</Button>} />
      <ErrorBox error={update.error} />
      <Table head={['Admin', 'Role', 'Status', 'Last sign-in', '']}>
        {data?.map((a) => (
          <tr key={a.id}>
            <td className="px-4 py-3"><p className="font-semibold">{a.name}</p><p className="text-xs text-gray-400">{a.email}</p></td>
            <td className="px-4 py-3">
              <Select value={a.role} disabled={a.id === me} onChange={(e) => update.mutate({ id: a.id, role: e.target.value as AdminRole })} className="max-w-[180px]">
                {ROLES.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
              </Select>
            </td>
            <td className="px-4 py-3"><Badge tone={a.active ? 'green' : 'red'}>{a.active ? 'active' : 'disabled'}</Badge></td>
            <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(a.lastLoginAt)}</td>
            <td className="px-4 py-3 text-right">
              {a.id !== me && <Button size="sm" variant="secondary" onClick={() => update.mutate({ id: a.id, active: !a.active })}>{a.active ? 'Disable' : 'Enable'}</Button>}
            </td>
          </tr>
        ))}
      </Table>

      <Card title="What each role can do" className="mt-6">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {ROLES.map((r) => (
            <div key={r} className="rounded-xl bg-gray-50 p-3">
              <p className="mb-1 text-sm font-bold">{r.replace('_', ' ')}</p>
              <p className="text-xs text-gray-600">{ROLE_PERMISSIONS[r].join(', ')}</p>
            </div>
          ))}
        </div>
      </Card>
      {creating && <CreateAdmin onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateAdmin({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'CONTENT' as AdminRole });
  const save = useMutation({
    mutationFn: () => api('/v1/admin/admins', { method: 'POST', json: f }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admins'] });
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title="Add admin">
      <div className="space-y-4">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Temporary password" hint="At least 10 characters. Share it privately."><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <Field label="Role">
          <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as AdminRole })}>
            {ROLES.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
          </Select>
        </Field>
        <ErrorBox error={save.error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Create</Button>
        </div>
      </div>
    </Modal>
  );
}
