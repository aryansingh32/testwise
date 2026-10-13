import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatRupees, REWARD_KIND_INFO, type AdminRedemptionDto, type CoinPackDto, type RewardDto, type RewardKind, type WalletDto, type WalletTxnDto } from '@testwise/shared';
import { Download, Pencil, Plus, Search, Upload } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Badge, Button, Card, cx, Empty, ErrorBox, Field, fmtDate, Input, Modal, PageHeader, Select, Table, Textarea, Toggle } from '../components/ui';
import { api, can } from '../lib/api';

interface Overview {
  wallets: number;
  purchased: number;
  earned: number;
  held: number;
  outstandingValuePaise: number;
  ledgerLiabilityPaise: number;
  pendingRedemptions: number;
  redemptions: { status: string; count: number; coins: number; costPaise: number }[];
  topUps: { count: number; amountPaise: number };
}
type AdminReward = RewardDto & { costPaise: number; stock: number | null; autoApprove: boolean; codesTotal: number; redemptionsTotal: number };

const STATUS_TONE: Record<string, 'amber' | 'blue' | 'green' | 'red' | 'gray'> = { PENDING: 'amber', APPROVED: 'blue', FULFILLED: 'green', REJECTED: 'red', FAILED: 'red', CANCELLED: 'gray' };

export function WalletPage() {
  const [tab, setTab] = useState<'redemptions' | 'rewards' | 'packs' | 'users'>('redemptions');
  const ov = useQuery({ queryKey: ['wallet-overview'], queryFn: () => api<Overview>('/v1/admin/wallet/overview'), refetchInterval: 30_000 });
  const o = ov.data;
  return (
    <>
      <PageHeader
        title="Wallet & rewards"
        subtitle="Coins students top up or earn, and the rewards they redeem them for. Purchased coins can never be paid out to UPI; only earned coins can."
        actions={<Link to="/settings#wallet.settings"><Button variant="secondary">Wallet settings</Button></Link>}
      />
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ['Pending requests', o?.pendingRedemptions],
          ['Purchased coins', o?.purchased.toLocaleString('en-IN')],
          ['Earned coins', o?.earned.toLocaleString('en-IN')],
          ['On hold', o?.held.toLocaleString('en-IN')],
          ['Coin liability', o ? formatRupees(o.ledgerLiabilityPaise) : '—'],
          ['Top-ups', o ? `${o.topUps.count} · ${formatRupees(o.topUps.amountPaise)}` : '—'],
        ].map(([k, v]) => (
          <Card key={k as string}><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{k}</p><p className="mt-2 text-xl font-extrabold tabular-nums">{v ?? '—'}</p></Card>
        ))}
      </div>
      {o && o.ledgerLiabilityPaise !== o.outstandingValuePaise && (
        <p className="mt-2 text-xs text-red-600">Ledger liability ({formatRupees(o.ledgerLiabilityPaise)}) differs from coins outstanding ({formatRupees(o.outstandingValuePaise)}) — usually because the coin value was changed after coins were issued.</p>
      )}
      <div className="mt-6 flex gap-2">
        {(['redemptions', 'rewards', 'packs', 'users'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx('rounded-xl px-4 py-2 text-sm font-semibold capitalize', tab === t ? 'bg-ink text-white' : 'bg-white text-gray-600 hover:bg-gray-100')}>
            {t === 'packs' ? 'Coin packs' : t === 'users' ? 'Student wallets' : t}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {tab === 'redemptions' && <Redemptions />}
        {tab === 'rewards' && <Rewards />}
        {tab === 'packs' && <Packs />}
        {tab === 'users' && <UserWallets />}
      </div>
    </>
  );
}

// ------------------------------------------------------------- Redemptions

function Redemptions() {
  const [status, setStatus] = useState('PENDING');
  const [kind, setKind] = useState('');
  const [acting, setActing] = useState<AdminRedemptionDto | null>(null);
  const q = useQuery({ queryKey: ['redemptions', status, kind], queryFn: () => api<AdminRedemptionDto[]>(`/v1/admin/wallet/redemptions?status=${status}${kind ? `&kind=${kind}` : ''}`), refetchInterval: 20_000 });
  async function csv() {
    const r = await api<{ filename: string; csv: string }>('/v1/admin/wallet/redemptions/shipping.csv');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv' }));
    a.download = r.filename;
    a.click();
  }
  return (
    <Card>
      <div className="mb-3 flex flex-wrap gap-2">
        <Select className="w-40" value={status} onChange={(e) => setStatus(e.target.value)}>{['PENDING', 'APPROVED', 'FULFILLED', 'REJECTED', 'FAILED', 'CANCELLED'].map((s) => <option key={s}>{s}</option>)}</Select>
        <Select className="w-44" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">All reward types</option>{(Object.keys(REWARD_KIND_INFO) as RewardKind[]).map((k) => <option key={k} value={k}>{REWARD_KIND_INFO[k].labelEn}</option>)}</Select>
        {can('wallet.write') && <Button variant="secondary" className="ml-auto" onClick={csv}><Download size={14} /> Approved merch → shipping CSV</Button>}
      </div>
      <ErrorBox error={q.error} />
      {!q.data?.length ? <Empty>No {status.toLowerCase()} redemptions.</Empty> : (
        <Table head={['Requested', 'Student', 'Reward', 'Coins', 'Details', 'Status', '']}>
          {q.data.map((r) => (
            <tr key={r.id}>
              <td className="px-3 py-2 text-xs text-gray-500">{fmtDate(r.createdAt)}</td>
              <td className="px-3 py-2 text-xs"><p className="font-semibold">{r.user.displayName}</p><p className="text-gray-400">{r.user.email ?? r.user.phone}</p></td>
              <td className="px-3 py-2 text-sm">{r.reward.titleEn}{r.variant && <Badge tone="gray">{r.variant}</Badge>}<p className="text-xs text-gray-400">{REWARD_KIND_INFO[r.reward.kind].labelEn} · cost {formatRupees(r.costPaise)}</p></td>
              <td className="px-3 py-2 text-xs tabular-nums">{r.coins.toLocaleString('en-IN')}<p className="text-gray-400">{r.fromPurchased} bought · {r.fromEarned} earned</p></td>
              <td className="px-3 py-2 text-xs text-gray-600">
                {r.upiVpa && <p>UPI: <b>{r.upiVpa}</b></p>}
                {r.shippingAddress && <p>{r.shippingAddress.name}, {r.shippingAddress.city} {r.shippingAddress.pincode} · {r.shippingAddress.phone}</p>}
                {r.voucherCode && <p>Code: <code>{r.voucherCode}</code></p>}
                {r.payoutRef && <p>Ref: {r.payoutRef}</p>}
                {r.trackingNo && <p>{r.carrier} {r.trackingNo}</p>}
                {r.rejectReason && <p className="text-red-600">{r.rejectReason}</p>}
              </td>
              <td className="px-3 py-2"><Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge></td>
              <td className="px-3 py-2">{can('wallet.write') && (r.status === 'PENDING' || r.status === 'APPROVED') && <Button size="sm" onClick={() => setActing(r)}>Process</Button>}</td>
            </tr>
          ))}
        </Table>
      )}
      {acting && <ProcessRedemption r={acting} onClose={() => setActing(null)} />}
    </Card>
  );
}

function ProcessRedemption({ r, onClose }: { r: AdminRedemptionDto; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ payoutRef: '', carrier: '', trackingNo: '', voucherCode: r.voucherCode ?? '', voucherPin: r.voucherPin ?? '', note: '', reason: '' });
  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/v1/admin/wallet/redemptions/${r.id}/action`, { method: 'POST', json: body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['redemptions'] });
      void qc.invalidateQueries({ queryKey: ['wallet-overview'] });
      onClose();
    },
  });
  const kind = r.reward.kind;
  const clean = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v.trim()));
  return (
    <Modal open onClose={onClose} title={`${r.reward.titleEn} for ${r.user.displayName}`}>
      <p className="mb-3 text-sm text-gray-600">{r.coins.toLocaleString('en-IN')} coins on hold · platform cost {formatRupees(r.costPaise)}</p>
      {kind === 'UPI_CASH' && <p className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Pay <b>{formatRupees(r.costPaise)}</b> to <b>{r.upiVpa}</b> from the payouts account, then enter the UPI transaction reference (UTR). Payouts above the dual-approval limit must be confirmed by a different admin from the one who approved.</p>}
      <div className="grid gap-3">
        {kind === 'UPI_CASH' && <Field label="UPI reference (UTR)"><Input value={f.payoutRef} onChange={(e) => setF({ ...f, payoutRef: e.target.value })} /></Field>}
        {kind === 'MERCH' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Courier"><Input value={f.carrier} onChange={(e) => setF({ ...f, carrier: e.target.value })} /></Field>
            <Field label="Tracking number"><Input value={f.trackingNo} onChange={(e) => setF({ ...f, trackingNo: e.target.value })} /></Field>
          </div>
        )}
        {kind === 'VOUCHER' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Voucher code" hint={r.voucherCode ? 'Reserved from uploaded codes' : 'No codes uploaded: enter one'}><Input value={f.voucherCode} onChange={(e) => setF({ ...f, voucherCode: e.target.value })} /></Field>
            <Field label="PIN (optional)"><Input value={f.voucherPin} onChange={(e) => setF({ ...f, voucherPin: e.target.value })} /></Field>
          </div>
        )}
        <Field label="Internal note (optional)"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <Field label="Reason (for reject / failed)"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Shown to the student; coins are returned" /></Field>
      </div>
      <ErrorBox error={m.error} />
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {r.status === 'PENDING' && <Button variant="danger" disabled={f.reason.trim().length < 3 || m.isPending} onClick={() => m.mutate({ action: 'REJECT', reason: f.reason })}>Reject</Button>}
        {r.status === 'APPROVED' && <Button variant="danger" disabled={f.reason.trim().length < 3 || m.isPending} onClick={() => m.mutate({ action: 'FAIL', reason: f.reason })}>Mark failed</Button>}
        {r.status === 'PENDING' && <Button variant="secondary" disabled={m.isPending} onClick={() => m.mutate({ action: 'APPROVE', ...clean({ note: f.note }) })}>Approve</Button>}
        {(kind !== 'UPI_CASH' || r.status === 'APPROVED') && (
          <Button disabled={m.isPending} onClick={() => m.mutate({ action: 'FULFILL', ...clean({ payoutRef: f.payoutRef, carrier: f.carrier, trackingNo: f.trackingNo, voucherCode: f.voucherCode, voucherPin: f.voucherPin, note: f.note }) })}>
            {kind === 'UPI_CASH' ? 'Mark paid' : kind === 'MERCH' ? 'Mark shipped' : 'Deliver'}
          </Button>
        )}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------- Rewards

const EMPTY_REWARD = { kind: 'MERCH' as RewardKind, titleEn: '', titleHi: '', descriptionEn: '', descriptionHi: '', termsEn: '', termsHi: '', imageUrl: '', brand: '', coinCost: 1000, valuePaise: 0, costPaise: 0, variants: [] as string[], stock: null as number | null, perUserLimit: null as number | null, requiresAddress: true, allowPurchasedCoins: true, autoApprove: false, active: true, sortOrder: 0 };

function Rewards() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-rewards'], queryFn: () => api<AdminReward[]>('/v1/admin/wallet/rewards') });
  const [editing, setEditing] = useState<(typeof EMPTY_REWARD & { id?: string }) | null>(null);
  const [codesFor, setCodesFor] = useState<AdminReward | null>(null);
  return (
    <Card title="Rewards catalog" actions={can('wallet.write') && <Button size="sm" onClick={() => setEditing({ ...EMPTY_REWARD })}><Plus size={14} /> Reward</Button>}>
      <ErrorBox error={q.error} />
      {!q.data?.length ? <Empty>No rewards yet.</Empty> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {q.data.map((r) => (
            <div key={r.id} className={cx('flex gap-3 rounded-2xl border border-gray-100 p-3', !r.active && 'opacity-50')}>
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-gray-100">{r.imageUrl && <img src={r.imageUrl} alt="" className="h-full w-full object-cover" />}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{r.titleEn}</p>
                <p className="text-xs text-gray-500">{REWARD_KIND_INFO[r.kind].labelEn} · {r.coinCost.toLocaleString('en-IN')} coins{r.valuePaise ? ` · value ${formatRupees(r.valuePaise)}` : ''} · cost {formatRupees(r.costPaise)}</p>
                <p className="text-xs text-gray-500">{r.stockLeft === null ? 'Unlimited' : `${r.stockLeft} left`} · {r.redemptionsTotal} redeemed{r.autoApprove ? ' · auto-approve' : ''}{!r.allowPurchasedCoins ? ' · earned coins only' : ''}</p>
                <div className="mt-2 flex gap-1">
                  {can('wallet.write') && <Button size="sm" variant="secondary" onClick={() => setEditing({ ...EMPTY_REWARD, ...r, titleHi: r.titleHi ?? '', descriptionEn: r.descriptionEn ?? '', descriptionHi: r.descriptionHi ?? '', termsEn: r.termsEn ?? '', termsHi: r.termsHi ?? '', imageUrl: r.imageUrl ?? '', brand: r.brand ?? '' })}><Pencil size={12} /> Edit</Button>}
                  {can('wallet.write') && r.kind === 'VOUCHER' && <Button size="sm" variant="secondary" onClick={() => setCodesFor(r)}><Upload size={12} /> Codes ({r.codesTotal})</Button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && <RewardEditor initial={editing} onClose={() => { setEditing(null); void qc.invalidateQueries({ queryKey: ['admin-rewards'] }); }} />}
      {codesFor && <VoucherCodes reward={codesFor} onClose={() => { setCodesFor(null); void qc.invalidateQueries({ queryKey: ['admin-rewards'] }); }} />}
    </Card>
  );
}

function RewardEditor({ initial, onClose }: { initial: typeof EMPTY_REWARD & { id?: string }; onClose: () => void }) {
  const [r, setR] = useState(initial);
  const set = (p: Partial<typeof r>) => setR((x) => ({ ...x, ...p }));
  const m = useMutation({
    mutationFn: () => {
      const { id, ...body } = r;
      const json = { ...body, allowPurchasedCoins: r.kind === 'UPI_CASH' ? false : r.allowPurchasedCoins, titleHi: r.titleHi || null, imageUrl: r.imageUrl || null, brand: r.brand || null };
      return id ? api(`/v1/admin/wallet/rewards/${id}`, { method: 'PUT', json }) : api('/v1/admin/wallet/rewards', { method: 'POST', json });
    },
    onSuccess: onClose,
  });
  async function upload(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await api<{ url: string }>('/v1/admin/wallet/rewards/image', { method: 'POST', body: fd });
    set({ imageUrl: res.url });
  }
  return (
    <Modal open onClose={onClose} title={r.id ? 'Edit reward' : 'New reward'} wide>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Type">
          <Select value={r.kind} onChange={(e) => { const kind = e.target.value as RewardKind; set({ kind, requiresAddress: kind === 'MERCH', allowPurchasedCoins: kind !== 'UPI_CASH' }); }}>
            {(Object.keys(REWARD_KIND_INFO) as RewardKind[]).map((k) => <option key={k} value={k}>{REWARD_KIND_INFO[k].labelEn}</option>)}
          </Select>
        </Field>
        <Field label="Brand (optional)"><Input value={r.brand} onChange={(e) => set({ brand: e.target.value })} /></Field>
        <Field label="Title (English)"><Input value={r.titleEn} onChange={(e) => set({ titleEn: e.target.value })} /></Field>
        <Field label="Title (Hindi)"><Input className="hindi" value={r.titleHi} onChange={(e) => set({ titleHi: e.target.value })} /></Field>
        <Field label="Description (English)"><Textarea rows={2} value={r.descriptionEn} onChange={(e) => set({ descriptionEn: e.target.value })} /></Field>
        <Field label="Description (Hindi)"><Textarea rows={2} className="hindi" value={r.descriptionHi} onChange={(e) => set({ descriptionHi: e.target.value })} /></Field>
        <Field label="Terms (English)"><Textarea rows={2} value={r.termsEn} onChange={(e) => set({ termsEn: e.target.value })} /></Field>
        <Field label="Terms (Hindi)"><Textarea rows={2} className="hindi" value={r.termsHi} onChange={(e) => set({ termsHi: e.target.value })} /></Field>
        <Field label="Coin price"><Input type="number" value={r.coinCost} onChange={(e) => set({ coinCost: Number(e.target.value) })} /></Field>
        <Field label={r.kind === 'UPI_CASH' ? 'UPI payout (₹)' : 'Face value (₹, shown to students)'}><Input type="number" value={r.valuePaise / 100} onChange={(e) => set({ valuePaise: Math.round(Number(e.target.value) * 100) })} /></Field>
        {r.kind !== 'UPI_CASH' && <Field label="Cost to us per unit (₹)" hint="For margin and ledger; not shown to students"><Input type="number" value={r.costPaise / 100} onChange={(e) => set({ costPaise: Math.round(Number(e.target.value) * 100) })} /></Field>}
        <Field label="Stock (blank = unlimited)" hint={r.kind === 'VOUCHER' ? 'Vouchers with uploaded codes use the codes as stock' : undefined}><Input type="number" value={r.stock ?? ''} onChange={(e) => set({ stock: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
        <Field label="Limit per student (blank = none)"><Input type="number" value={r.perUserLimit ?? ''} onChange={(e) => set({ perUserLimit: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
        <Field label="Sizes / variants (comma separated)"><Input value={r.variants.join(', ')} onChange={(e) => set({ variants: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></Field>
        <Field label="Sort order"><Input type="number" value={r.sortOrder} onChange={(e) => set({ sortOrder: Number(e.target.value) })} /></Field>
        <Field label="Image">
          <div className="flex items-center gap-2">
            {r.imageUrl && <img src={r.imageUrl} alt="" className="h-12 w-12 rounded-lg object-cover" />}
            <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} className="text-xs" />
          </div>
        </Field>
        <div className="space-y-2 rounded-xl bg-gray-50 p-3">
          <Toggle checked={r.active} onChange={(v) => set({ active: v })} label="Visible in the app" />
          <Toggle checked={r.requiresAddress} onChange={(v) => set({ requiresAddress: v })} label="Needs a delivery address" disabled={r.kind === 'MERCH'} />
          <Toggle checked={r.kind !== 'UPI_CASH' && r.allowPurchasedCoins} onChange={(v) => set({ allowPurchasedCoins: v })} label="Purchased coins can be used" disabled={r.kind === 'UPI_CASH'} />
          <Toggle checked={r.autoApprove} onChange={(v) => set({ autoApprove: v })} label="Approve automatically (vouchers with codes deliver instantly)" disabled={r.kind === 'UPI_CASH'} />
        </div>
      </div>
      {r.kind === 'UPI_CASH' && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">UPI payouts are cash prizes: they appear only when “Allow cash rewards” (Money model) and “UPI payouts” (Wallet settings) are both on, are paid only from earned coins, only to adult accounts, and always need manual approval. Get legal advice before enabling.</p>}
      <ErrorBox error={m.error} />
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={m.isPending || r.titleEn.trim().length < 2} onClick={() => m.mutate()}>Save</Button></div>
    </Modal>
  );
}

function VoucherCodes({ reward, onClose }: { reward: AdminReward; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const counts = useQuery({ queryKey: ['codes', reward.id], queryFn: () => api<{ free: number; used: number; expired: number }>(`/v1/admin/wallet/rewards/${reward.id}/codes`) });
  const parsed = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^code\b/i.test(l))
    .map((l) => {
      const [code, pin, expires] = l.split(/[,\t]/).map((x) => x?.trim());
      return { code, pin: pin || null, expiresAt: expires ? new Date(expires).toISOString() : null };
    })
    .filter((c) => c.code && c.code.length >= 3);
  const add = useMutation({ mutationFn: () => api<{ added: number; duplicates: number }>(`/v1/admin/wallet/rewards/${reward.id}/codes`, { method: 'POST', json: { codes: parsed } }), onSuccess: () => { setText(''); void qc.invalidateQueries({ queryKey: ['codes', reward.id] }); } });
  const clear = useMutation({ mutationFn: () => api(`/v1/admin/wallet/rewards/${reward.id}/codes/unused`, { method: 'DELETE' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['codes', reward.id] }) });
  return (
    <Modal open onClose={onClose} title={`Voucher codes · ${reward.titleEn}`}>
      <p className="text-sm text-gray-600">{counts.data ? `${counts.data.free} available · ${counts.data.used} issued · ${counts.data.expired} expired` : '…'}</p>
      <Field label="Paste codes (one per line: code, pin, expiry date) or open a CSV" className="mt-3">
        <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={'AMZ-1234-5678\nAMZ-2345-6789, 4421, 2027-03-31'} />
      </Field>
      <input type="file" accept=".csv,.txt" className="mt-2 text-xs" onChange={(e) => e.target.files?.[0]?.text().then(setText)} />
      {add.data && <p className="mt-2 text-sm text-emerald-700">Added {add.data.added}{add.data.duplicates ? `, skipped ${add.data.duplicates} duplicates` : ''}.</p>}
      <ErrorBox error={add.error ?? clear.error} />
      <div className="mt-4 flex justify-between gap-2">
        <Button variant="danger" size="sm" onClick={() => clear.mutate()} disabled={!counts.data?.free}>Remove unissued codes</Button>
        <Button disabled={!parsed.length || add.isPending} onClick={() => add.mutate()}>Add {parsed.length} codes</Button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------- Coin packs

function Packs() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-packs'], queryFn: () => api<CoinPackDto[]>('/v1/admin/wallet/packs') });
  const [editing, setEditing] = useState<Partial<CoinPackDto> | null>(null);
  const save = useMutation({
    mutationFn: (p: Partial<CoinPackDto>) => {
      const { id, ...body } = p;
      const json = { ...body, titleHi: body.titleHi || null, badgeEn: body.badgeEn || null, badgeHi: body.badgeHi || null };
      return id ? api(`/v1/admin/wallet/packs/${id}`, { method: 'PUT', json }) : api('/v1/admin/wallet/packs', { method: 'POST', json });
    },
    onSuccess: () => { setEditing(null); void qc.invalidateQueries({ queryKey: ['admin-packs'] }); },
  });
  return (
    <Card title="Coin packs" actions={can('wallet.write') && <Button size="sm" onClick={() => setEditing({ titleEn: '', coins: 500, bonusCoins: 0, pricePaise: 5000, active: true, sortOrder: 0 })}><Plus size={14} /> Pack</Button>}>
      <p className="mb-3 text-xs text-gray-500">Top-ups go through the active payment gateway. Coupons never apply to top-ups. Bonus coins are booked as promotion expense.</p>
      {!q.data?.length ? <Empty>No packs.</Empty> : (
        <Table head={['Pack', 'Coins', 'Bonus', 'Price', 'Per ₹', 'Status', '']}>
          {q.data.map((p) => (
            <tr key={p.id} className={p.active ? '' : 'opacity-50'}>
              <td className="px-3 py-2 text-sm font-semibold">{p.titleEn} {p.badgeEn && <Badge tone="amber">{p.badgeEn}</Badge>}</td>
              <td className="px-3 py-2 tabular-nums">{p.coins}</td>
              <td className="px-3 py-2 tabular-nums">{p.bonusCoins}</td>
              <td className="px-3 py-2 tabular-nums">{formatRupees(p.pricePaise)}</td>
              <td className="px-3 py-2 text-xs text-gray-500">{((p.coins + p.bonusCoins) / (p.pricePaise / 100)).toFixed(1)}</td>
              <td className="px-3 py-2"><Badge tone={p.active ? 'green' : 'gray'}>{p.active ? 'on sale' : 'hidden'}</Badge></td>
              <td className="px-3 py-2">{can('wallet.write') && <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>Edit</Button>}</td>
            </tr>
          ))}
        </Table>
      )}
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing.id ? 'Edit pack' : 'New pack'}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name (English)"><Input value={editing.titleEn ?? ''} onChange={(e) => setEditing({ ...editing, titleEn: e.target.value })} /></Field>
            <Field label="Name (Hindi)"><Input className="hindi" value={editing.titleHi ?? ''} onChange={(e) => setEditing({ ...editing, titleHi: e.target.value })} /></Field>
            <Field label="Coins"><Input type="number" value={editing.coins ?? 0} onChange={(e) => setEditing({ ...editing, coins: Number(e.target.value) })} /></Field>
            <Field label="Bonus coins"><Input type="number" value={editing.bonusCoins ?? 0} onChange={(e) => setEditing({ ...editing, bonusCoins: Number(e.target.value) })} /></Field>
            <Field label="Price (₹)"><Input type="number" value={(editing.pricePaise ?? 0) / 100} onChange={(e) => setEditing({ ...editing, pricePaise: Math.round(Number(e.target.value) * 100) })} /></Field>
            <Field label="Sort order"><Input type="number" value={editing.sortOrder ?? 0} onChange={(e) => setEditing({ ...editing, sortOrder: Number(e.target.value) })} /></Field>
            <Field label="Badge (English)"><Input value={editing.badgeEn ?? ''} onChange={(e) => setEditing({ ...editing, badgeEn: e.target.value })} /></Field>
            <Field label="Badge (Hindi)"><Input className="hindi" value={editing.badgeHi ?? ''} onChange={(e) => setEditing({ ...editing, badgeHi: e.target.value })} /></Field>
          </div>
          <div className="mt-3"><Toggle checked={editing.active ?? true} onChange={(v) => setEditing({ ...editing, active: v })} label="On sale" /></div>
          <ErrorBox error={save.error} />
          <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button disabled={save.isPending} onClick={() => save.mutate(editing)}>Save</Button></div>
        </Modal>
      )}
    </Card>
  );
}

// ------------------------------------------------------------- Student wallets

function UserWallets() {
  const [search, setSearch] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const users = useQuery({ queryKey: ['wallet-user-search', search], queryFn: () => api<{ items: { id: string; displayName: string; email: string | null }[] }>(`/v1/admin/users?q=${encodeURIComponent(search)}&pageSize=10`), enabled: search.length >= 2 });
  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <Card title="Find a student">
        <div className="relative"><Search size={14} className="absolute left-3 top-3 text-gray-400" /><Input className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or email" /></div>
        <ul className="mt-2 divide-y divide-gray-50">
          {users.data?.items?.map((u) => (
            <li key={u.id}><button className={cx('w-full py-2 text-left text-sm', userId === u.id && 'font-bold text-brand-600')} onClick={() => setUserId(u.id)}>{u.displayName}<span className="block text-xs text-gray-400">{u.email}</span></button></li>
          ))}
        </ul>
      </Card>
      {userId ? <UserWallet userId={userId} /> : <Empty>Search for a student to see their wallet.</Empty>}
    </div>
  );
}

function UserWallet({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['user-wallet', userId], queryFn: () => api<{ wallet: WalletDto; transactions: WalletTxnDto[]; redemptions: AdminRedemptionDto[] }>(`/v1/admin/wallet/users/${userId}`) });
  const [adj, setAdj] = useState({ bucket: 'EARNED', amount: 0, reason: '', notify: true });
  const adjust = useMutation({ mutationFn: () => api(`/v1/admin/wallet/users/${userId}/adjust`, { method: 'POST', json: adj }), onSuccess: () => { setAdj({ ...adj, amount: 0, reason: '' }); void qc.invalidateQueries({ queryKey: ['user-wallet', userId] }); } });
  const [freezeReason, setFreezeReason] = useState('');
  const freeze = useMutation({ mutationFn: (frozen: boolean) => api(`/v1/admin/wallet/users/${userId}/freeze`, { method: 'POST', json: { frozen, reason: freezeReason || null } }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['user-wallet', userId] }) });
  const w = q.data?.wallet;
  return (
    <div className="space-y-4">
      <ErrorBox error={q.error} />
      {w && (
        <Card title="Balance" actions={w.frozen ? <Badge tone="red">frozen: {w.frozenReason}</Badge> : null}>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[['Purchased', w.purchased], ['Earned (withdrawable)', w.earned], ['On hold', w.held]].map(([k, v]) => (
              <div key={k as string} className="rounded-xl bg-gray-50 p-3"><p className="text-xs text-gray-500">{k}</p><p className="text-2xl font-extrabold tabular-nums">{(v as number).toLocaleString('en-IN')}</p></div>
            ))}
          </div>
          {can('wallet.write') && (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-gray-100 p-3">
                <p className="mb-2 text-sm font-semibold">Credit / debit coins</p>
                <div className="grid grid-cols-2 gap-2">
                  <Select value={adj.bucket} onChange={(e) => setAdj({ ...adj, bucket: e.target.value })}><option value="EARNED">Earned</option><option value="PURCHASED">Purchased</option></Select>
                  <Input type="number" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: Number(e.target.value) })} placeholder="+/- coins" />
                </div>
                <Input className="mt-2" value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} placeholder="Reason (shown to student, audited)" />
                <div className="mt-2 flex items-center justify-between"><Toggle checked={adj.notify} onChange={(v) => setAdj({ ...adj, notify: v })} label="Notify" /><Button size="sm" disabled={!adj.amount || adj.reason.trim().length < 5 || adjust.isPending} onClick={() => adjust.mutate()}>Apply</Button></div>
                <ErrorBox error={adjust.error} />
              </div>
              <div className="rounded-xl border border-gray-100 p-3">
                <p className="mb-2 text-sm font-semibold">Freeze wallet</p>
                <p className="mb-2 text-xs text-gray-500">Blocks top-ups and redemptions (e.g. during a fraud review). Balances are kept.</p>
                <Input value={freezeReason} onChange={(e) => setFreezeReason(e.target.value)} placeholder="Reason" />
                <div className="mt-2 flex justify-end">{w.frozen ? <Button size="sm" variant="secondary" onClick={() => freeze.mutate(false)}>Unfreeze</Button> : <Button size="sm" variant="danger" onClick={() => freeze.mutate(true)}>Freeze</Button>}</div>
              </div>
            </div>
          )}
        </Card>
      )}
      <Card title="Coin history">
        {!q.data?.transactions.length ? <Empty>No coin movements.</Empty> : (
          <Table head={['When', 'Type', 'Purchased', 'Earned', 'Held', 'Memo']}>
            {q.data.transactions.map((t) => (
              <tr key={t.id}>
                <td className="px-3 py-2 text-xs text-gray-500">{fmtDate(t.createdAt)}</td>
                <td className="px-3 py-2 text-xs"><Badge tone="gray">{t.type}</Badge></td>
                {[t.purchasedDelta, t.earnedDelta, t.heldDelta].map((d, i) => <td key={i} className={cx('px-3 py-2 text-xs tabular-nums', d > 0 ? 'text-emerald-700' : d < 0 ? 'text-red-600' : 'text-gray-300')}>{d > 0 ? `+${d}` : d || '·'}</td>)}
                <td className="px-3 py-2 text-xs">{t.memo}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
