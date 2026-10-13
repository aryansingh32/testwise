import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatRupees } from '@testwise/shared';
import { ArrowLeft, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Badge, Button, Card, Empty, ErrorBox, Field, fmtDate, Input, Modal, PageHeader, Pager, Select, Table, cx } from '../components/ui';
import { api, can } from '../lib/api';

const orderTone = (s: string) => (({ PAID: 'green', CREATED: 'amber', FAILED: 'red', CANCELLED: 'gray', REFUND_PENDING: 'violet', REFUNDED: 'blue' }) as const)[s as 'PAID'] ?? 'gray';
const refundTone = (s: string) => (({ REQUESTED: 'amber', APPROVED: 'violet', PROCESSED: 'green', REJECTED: 'gray', FAILED: 'red' }) as const)[s as 'REQUESTED'] ?? 'gray';

const ACCOUNT_HELP: Record<string, string> = {
  GATEWAY_RECEIVABLE: 'Money held by the gateway, due to settle to the bank',
  GATEWAY_FEES: 'Gateway charges',
  PLATFORM_REVENUE: 'Testwise revenue (store sales, platform share of entries)',
  PRIZE_POOL_LIABILITY: 'Entry-fee money owed to winners — not revenue',
  PLATFORM_PRIZE_EXPENSE: 'Prizes funded by Testwise',
  SPONSOR_FUNDS: 'Prizes funded by sponsors',
  PRIZES_PAYABLE: 'Approved prizes not yet paid out',
  PAYOUTS_BANK: 'Prizes paid out',
};

type Tab = 'overview' | 'orders' | 'refunds' | 'ledger' | 'webhooks';

export function FinancePage() {
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <>
      <PageHeader title="Finance" subtitle="Every rupee has an order, a gateway event and balanced ledger entries. Corrections are new entries — history is never edited." />
      <div className="mb-5 flex w-fit flex-wrap gap-1 rounded-xl bg-gray-100 p-1 text-sm font-semibold">
        {(['overview', 'orders', 'refunds', 'ledger', 'webhooks'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx('rounded-lg px-4 py-1.5 capitalize', tab === t && 'bg-white shadow')}>{t}</button>
        ))}
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'orders' && <Orders />}
      {tab === 'refunds' && <Refunds />}
      {tab === 'ledger' && <Ledger />}
      {tab === 'webhooks' && <Webhooks />}
    </>
  );
}

interface Summary {
  ordersPaid: number; capturedPaise: number; refundsProcessed: number; refundedPaise: number; expectedReceivablePaise: number; ledgerReceivablePaise: number;
  matched: boolean; failedWebhookEvents: number; pendingRefunds: number; providers: { name: string; configured: boolean }[];
  balances: { account: string; debitPaise: number; creditPaise: number; netCreditPaise: number }[];
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return <Card><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p><p className="mt-2 text-2xl font-extrabold tabular-nums">{value}</p>{sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}</Card>;
}

function Overview() {
  const { data } = useQuery({ queryKey: ['finance-summary'], queryFn: () => api<Summary>('/v1/admin/finance/summary') });
  if (!data) return <p className="text-sm text-gray-500">Loading…</p>;
  const bal = (a: string) => data.balances.find((b) => b.account === a)?.netCreditPaise ?? 0;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Collected" value={formatRupees(data.capturedPaise)} sub={`${data.ordersPaid} paid orders`} />
        <Stat label="Refunded" value={formatRupees(data.refundedPaise)} sub={`${data.refundsProcessed} refunds · ${data.pendingRefunds} pending`} />
        <Stat label="Net revenue" value={formatRupees(bal('PLATFORM_REVENUE'))} />
        <Stat label="Prize money owed" value={formatRupees(bal('PRIZE_POOL_LIABILITY') + bal('PRIZES_PAYABLE'))} sub="Held for winners, separate from revenue" />
      </div>
      <Card title="Reconciliation">
        <div className={cx('flex items-center gap-3 rounded-xl p-4', data.matched ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800')}>
          {data.matched ? <CheckCircle2 /> : <AlertTriangle />}
          <div className="text-sm">
            <p className="font-bold">{data.matched ? 'Gateway records match the ledger' : 'Mismatch between gateway records and the ledger'}</p>
            <p>Expected at gateway: {formatRupees(data.expectedReceivablePaise)} · Ledger: {formatRupees(data.ledgerReceivablePaise)}</p>
          </div>
        </div>
        {data.failedWebhookEvents > 0 && <p className="mt-3 text-sm text-red-600">{data.failedWebhookEvents} webhook event(s) failed processing — see Webhooks.</p>}
      </Card>
      <Card title="Gateways">
        <ul className="space-y-2 text-sm">
          {data.providers.map((p) => (
            <li key={p.name} className="flex items-center justify-between"><span className="font-semibold">{p.name}</span><Badge tone={p.configured ? 'green' : 'gray'}>{p.configured ? 'configured' : 'not configured'}</Badge></li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-gray-500">Choose the active gateway in Settings → Payment gateway. Razorpay needs RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET on the server. Paytm is not integrated yet.</p>
      </Card>
    </div>
  );
}

interface OrderRow { id: string; receiptNo: string; descriptionEn: string; amountPaise: number; discountPaise: number; status: string; provider: string; createdAt: string; user: { displayName: string; email: string | null } }

function Orders() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const { data } = useQuery({ queryKey: ['orders', status, q, page], queryFn: () => api<{ items: OrderRow[]; total: number; page: number; pageSize: number }>(`/v1/admin/finance/orders?${new URLSearchParams({ ...(status && { status }), ...(q && { q }), page: String(page) })}`) });
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-3">
        <Input placeholder="Receipt no, email or payment ID — Enter" className="max-w-sm" onKeyDown={(e) => { if (e.key === 'Enter') { setQ(e.currentTarget.value); setPage(1); } }} />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="max-w-[200px]">
          <option value="">All statuses</option>
          {['CREATED', 'PAID', 'FAILED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </Select>
      </div>
      {!data?.items.length ? <Empty>No orders.</Empty> : (
        <>
          <Table head={['Receipt', 'Student', 'Item', 'Amount', 'Status', 'Created']}>
            {data.items.map((o) => (
              <tr key={o.id} className="cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/finance/orders/${o.id}`)}>
                <td className="px-4 py-3 font-mono text-xs">{o.receiptNo}<p className="font-sans text-gray-400">{o.provider}</p></td>
                <td className="px-4 py-3 text-xs">{o.user.displayName}<p className="text-gray-400">{o.user.email}</p></td>
                <td className="px-4 py-3 text-xs">{o.descriptionEn}</td>
                <td className="px-4 py-3 text-sm font-semibold tabular-nums">{formatRupees(o.amountPaise)}{o.discountPaise > 0 && <p className="text-xs font-normal text-gray-400">−{formatRupees(o.discountPaise)} coupon</p>}</td>
                <td className="px-4 py-3"><Badge tone={orderTone(o.status)}>{o.status.replace('_', ' ')}</Badge></td>
                <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(o.createdAt)}</td>
              </tr>
            ))}
          </Table>
          <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </>
  );
}

interface RefundRow { id: string; amountPaise: number; reason: string; status: string; requestedBy: string; approvedById: string | null; secondApproverId: string | null; createdAt: string; orderId: string; order: { receiptNo: string; amountPaise: number; descriptionEn: string; user: { email: string | null } } }

function Refunds() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('REQUESTED');
  const { data } = useQuery({ queryKey: ['refunds', status], queryFn: () => api<RefundRow[]>(`/v1/admin/finance/refunds${status ? `?status=${status}` : ''}`) });
  const act = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: 'approve' | 'reject'; reason?: string }) => api(`/v1/admin/finance/refunds/${id}/${action}`, { method: 'POST', json: reason ? { reason } : {} }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['refunds'] }),
  });
  return (
    <>
      <Select value={status} onChange={(e) => setStatus(e.target.value)} className="mb-4 max-w-[200px]">
        <option value="">All</option>
        {['REQUESTED', 'APPROVED', 'PROCESSED', 'REJECTED', 'FAILED'].map((s) => <option key={s}>{s}</option>)}
      </Select>
      <ErrorBox error={act.error} />
      {!data?.length ? <Empty>No refunds.</Empty> : (
        <Table head={['Order', 'Amount', 'Reason', 'Status', 'Requested', '']}>
          {data.map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-3 text-xs"><Link className="font-mono hover:text-brand-600" to={`/finance/orders/${r.orderId}`}>{r.order.receiptNo}</Link><p className="text-gray-400">{r.order.user.email}</p></td>
              <td className="px-4 py-3 text-sm font-semibold">{formatRupees(r.amountPaise)}<p className="text-xs font-normal text-gray-400">of {formatRupees(r.order.amountPaise)}</p></td>
              <td className="px-4 py-3 text-xs">{r.reason}</td>
              <td className="px-4 py-3"><Badge tone={refundTone(r.status)}>{r.status}</Badge>{r.status === 'APPROVED' && <p className="mt-1 text-[11px] text-violet-700">Awaiting 2nd approval</p>}</td>
              <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(r.createdAt)}<p>{r.requestedBy === 'SYSTEM' ? 'System' : 'Admin'}</p></td>
              <td className="px-4 py-3 text-right">
                {can('finance.write') && ['REQUESTED', 'APPROVED'].includes(r.status) && (
                  <div className="flex justify-end gap-2">
                    <Button size="sm" onClick={() => act.mutate({ id: r.id, action: 'approve' })}>{r.status === 'APPROVED' ? 'Second approval' : 'Approve'}</Button>
                    <Button size="sm" variant="secondary" onClick={() => { const reason = window.prompt('Reason for rejecting'); if (reason) act.mutate({ id: r.id, action: 'reject', reason }); }}>Reject</Button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      <p className="mt-3 text-xs text-gray-500">Refunds above the threshold in Settings → Payment rules need two different approvers. The requester can never approve their own refund.</p>
    </>
  );
}

function Ledger() {
  const [account, setAccount] = useState('');
  const [page, setPage] = useState(1);
  const { data } = useQuery({ queryKey: ['ledger', account, page], queryFn: () => api<{ items: { id: string; txnId: string; account: string; debitPaise: number; creditPaise: number; memo: string; createdAt: string; orderId: string | null }[]; total: number; page: number; pageSize: number; balances: Summary['balances'] }>(`/v1/admin/finance/ledger?${new URLSearchParams({ ...(account && { account }), page: String(page) })}`) });
  return (
    <div className="space-y-6">
      <Card title="Account balances">
        <Table head={['Account', 'Debits', 'Credits', 'Net']}>
          {data?.balances.map((b) => (
            <tr key={b.account} className="cursor-pointer hover:bg-gray-50" onClick={() => { setAccount(b.account); setPage(1); }}>
              <td className="px-4 py-2"><p className="font-mono text-xs font-bold">{b.account}</p><p className="text-xs text-gray-400">{ACCOUNT_HELP[b.account]}</p></td>
              <td className="px-4 py-2 text-xs tabular-nums">{formatRupees(b.debitPaise)}</td>
              <td className="px-4 py-2 text-xs tabular-nums">{formatRupees(b.creditPaise)}</td>
              <td className="px-4 py-2 text-sm font-semibold tabular-nums">{formatRupees(Math.abs(b.netCreditPaise))} {b.netCreditPaise >= 0 ? 'Cr' : 'Dr'}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title={account ? `Entries · ${account}` : 'All entries'} actions={account && <Button size="sm" variant="ghost" onClick={() => setAccount('')}>Show all</Button>}>
        <Table head={['When', 'Account', 'Debit', 'Credit', 'Memo']}>
          {data?.items.map((e) => (
            <tr key={e.id}>
              <td className="px-4 py-2 text-xs text-gray-500">{fmtDate(e.createdAt)}</td>
              <td className="px-4 py-2 font-mono text-xs">{e.account}</td>
              <td className="px-4 py-2 text-xs tabular-nums">{e.debitPaise ? formatRupees(e.debitPaise) : ''}</td>
              <td className="px-4 py-2 text-xs tabular-nums">{e.creditPaise ? formatRupees(e.creditPaise) : ''}</td>
              <td className="px-4 py-2 text-xs">{e.orderId ? <Link className="hover:text-brand-600" to={`/finance/orders/${e.orderId}`}>{e.memo}</Link> : e.memo}</td>
            </tr>
          ))}
        </Table>
        {data && <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>
    </div>
  );
}

function Webhooks() {
  const { data } = useQuery({ queryKey: ['webhooks'], queryFn: () => api<{ id: string; provider: string; eventId: string; type: string; orderId: string | null; signatureValid: boolean; processedAt: string | null; error: string | null; receivedAt: string }[]>('/v1/admin/finance/webhooks') });
  if (!data?.length) return <Empty>No gateway events yet.</Empty>;
  return (
    <Table head={['Received', 'Provider', 'Event', 'Signature', 'Result']}>
      {data.map((e) => (
        <tr key={e.id}>
          <td className="px-4 py-2 text-xs text-gray-500">{fmtDate(e.receivedAt)}</td>
          <td className="px-4 py-2 text-xs">{e.provider}</td>
          <td className="px-4 py-2 text-xs">{e.type}<p className="font-mono text-gray-400">{e.eventId}</p></td>
          <td className="px-4 py-2"><Badge tone={e.signatureValid ? 'green' : 'red'}>{e.signatureValid ? 'valid' : 'invalid'}</Badge></td>
          <td className="px-4 py-2 text-xs">{e.error ? <span className="text-red-600">{e.error}</span> : e.processedAt ? 'Processed' : 'Pending'}{e.orderId && <Link className="ml-2 text-brand-600" to={`/finance/orders/${e.orderId}`}>order</Link>}</td>
        </tr>
      ))}
    </Table>
  );
}

export function OrderDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [refund, setRefund] = useState<{ amount: string; reason: string } | null>(null);
  type O = OrderRow & { kind: string; couponCode: string | null; providerOrderId: string | null; providerPaymentId: string | null; paidAt: string | null; failureReason: string | null;
    user: { id: string; displayName: string; email: string | null };
    refunds: RefundRow[]; events: { id: string; type: string; eventId: string; signatureValid: boolean; processedAt: string | null; error: string | null; receivedAt: string }[];
    ledger: { id: string; txnId: string; account: string; debitPaise: number; creditPaise: number; memo: string; createdAt: string }[] };
  const { data: o } = useQuery({ queryKey: ['order', id], queryFn: () => api<O>(`/v1/admin/finance/orders/${id}`) });
  const req = useMutation({
    mutationFn: () => api(`/v1/admin/finance/orders/${id}/refund`, { method: 'POST', json: { amountPaise: refund!.amount ? Math.round(Number(refund!.amount) * 100) : undefined, reason: refund!.reason } }),
    onSuccess: () => { setRefund(null); void qc.invalidateQueries({ queryKey: ['order', id] }); },
  });
  if (!o) return <p className="text-sm text-gray-500">Loading…</p>;
  return (
    <>
      <Link to="/finance" className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-ink"><ArrowLeft size={14} /> Finance</Link>
      <PageHeader title={o.receiptNo} subtitle={o.descriptionEn} actions={<>
        <Badge tone={orderTone(o.status)}>{o.status.replace('_', ' ')}</Badge>
        {can('finance.write') && ['PAID', 'REFUND_PENDING'].includes(o.status) && <Button size="sm" variant="secondary" onClick={() => setRefund({ amount: '', reason: '' })}>Request refund</Button>}
      </>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Order">
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-gray-500">Student</dt><dd>{o.user.displayName}<br /><span className="text-xs text-gray-400">{o.user.email}</span></dd>
            <dt className="text-gray-500">Amount</dt><dd className="font-semibold">{formatRupees(o.amountPaise)}</dd>
            <dt className="text-gray-500">Discount</dt><dd>{o.discountPaise ? `${formatRupees(o.discountPaise)} (${o.couponCode})` : '—'}</dd>
            <dt className="text-gray-500">Gateway</dt><dd>{o.provider}</dd>
            <dt className="text-gray-500">Gateway order</dt><dd className="font-mono text-xs">{o.providerOrderId ?? '—'}</dd>
            <dt className="text-gray-500">Payment ID</dt><dd className="font-mono text-xs">{o.providerPaymentId ?? '—'}</dd>
            <dt className="text-gray-500">Created</dt><dd>{fmtDate(o.createdAt)}</dd>
            <dt className="text-gray-500">Paid</dt><dd>{fmtDate(o.paidAt)}</dd>
            {o.failureReason && <><dt className="text-gray-500">Failure</dt><dd className="text-red-600">{o.failureReason}</dd></>}
          </dl>
        </Card>
        <Card title="Gateway events">
          {!o.events.length ? <p className="text-sm text-gray-500">None</p> : (
            <ul className="space-y-2 text-sm">{o.events.map((e) => <li key={e.id} className="flex justify-between gap-2"><span>{e.type} <Badge tone={e.signatureValid ? 'green' : 'red'}>{e.signatureValid ? 'signed' : 'bad sig'}</Badge></span><span className="text-xs text-gray-400">{fmtDate(e.receivedAt)}</span></li>)}</ul>
          )}
        </Card>
        <Card title="Refunds">
          {!o.refunds.length ? <p className="text-sm text-gray-500">None</p> : (
            <ul className="space-y-2 text-sm">{o.refunds.map((r) => <li key={r.id} className="flex justify-between gap-2"><span>{formatRupees(r.amountPaise)} — {r.reason}</span><Badge tone={refundTone(r.status)}>{r.status}</Badge></li>)}</ul>
          )}
        </Card>
        <Card title="Ledger entries">
          <Table head={['Account', 'Debit', 'Credit', 'Memo']}>
            {o.ledger.map((e) => (
              <tr key={e.id}><td className="px-3 py-2 font-mono text-[11px]">{e.account}</td><td className="px-3 py-2 text-xs">{e.debitPaise ? formatRupees(e.debitPaise) : ''}</td><td className="px-3 py-2 text-xs">{e.creditPaise ? formatRupees(e.creditPaise) : ''}</td><td className="px-3 py-2 text-xs text-gray-500">{e.memo}</td></tr>
            ))}
          </Table>
        </Card>
      </div>
      <Modal open={!!refund} onClose={() => setRefund(null)} title="Request refund">
        <div className="space-y-4">
          <Field label="Amount (₹)" hint={`Blank = full remaining amount of ${formatRupees(o.amountPaise)}`}><Input type="number" min={1} value={refund?.amount ?? ''} onChange={(e) => setRefund({ ...refund!, amount: e.target.value })} /></Field>
          <Field label="Reason (shown to the student)"><Input value={refund?.reason ?? ''} onChange={(e) => setRefund({ ...refund!, reason: e.target.value })} /></Field>
          <p className="text-xs text-gray-500">Another admin must approve this request.</p>
          <ErrorBox error={req.error} />
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setRefund(null)}>Cancel</Button><Button disabled={!refund?.reason || req.isPending} onClick={() => req.mutate()}>Submit request</Button></div>
        </div>
      </Modal>
    </>
  );
}
