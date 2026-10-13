import { useQuery } from '@tanstack/react-query';
import { formatRupees, type TournamentCardDto } from '@testwise/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Badge, Button, Empty, fmtDate, Input, PageHeader, Select, statusTone, Table } from '../components/ui';
import { api, can } from '../lib/api';

export function TournamentsPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['tournaments', status, q],
    queryFn: () => api<TournamentCardDto[]>(`/v1/admin/tournaments?${new URLSearchParams({ ...(status && { status }), ...(q && { q }) })}`),
  });
  return (
    <>
      <PageHeader
        title="Tournaments"
        subtitle="Create, schedule and run Test Wars. Registration opens and closes automatically at the configured times."
        actions={can('tournament.write') && <Link to="/tournaments/new"><Button><Plus size={16} /> New tournament</Button></Link>}
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input placeholder="Search title or slug" className="max-w-xs" onKeyDown={(e) => e.key === 'Enter' && setQ(e.currentTarget.value)} />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[200px]">
          <option value="">All statuses</option>
          {['DRAFT', 'SCHEDULED', 'REG_OPEN', 'REG_CLOSED', 'LIVE', 'IN_REVIEW', 'FINAL', 'CLOSED', 'CANCELLED'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </Select>
      </div>
      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : !data?.length ? (
        <Empty>No tournaments yet.</Empty>
      ) : (
        <Table head={['Tournament', 'Status', 'Starts', 'Entry', 'Registered', 'Reward']}>
          {data.map((t) => (
            <tr key={t.id} className="cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/tournaments/${t.id}`)}>
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="h-9 w-9 shrink-0 rounded-xl" style={{ background: t.bannerColor }} />
                  <div>
                    <p className="font-semibold">{t.titleEn} {t.featured && <Badge tone="amber">featured</Badge>}</p>
                    <p className="text-xs text-gray-400">{t.exam?.nameEn ?? 'All exams'} · {t.format} · {t.questionCount} Qs / {t.durationMinutes} min</p>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3"><Badge tone={statusTone(t.status)}>{t.status.replace('_', ' ')}</Badge></td>
              <td className="px-4 py-3 text-xs text-gray-600">{fmtDate(t.startsAt)}</td>
              <td className="px-4 py-3 text-xs">{t.entryMode === 'FREE' ? 'Free' : formatRupees(t.entryFeePaise)}</td>
              <td className="px-4 py-3 text-xs tabular-nums">{t.participantCount} / {t.maxParticipants}</td>
              <td className="px-4 py-3 text-xs">{t.prizePoolPaise ? formatRupees(t.prizePoolPaise) : t.topRewardEn ?? t.rewardType}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
