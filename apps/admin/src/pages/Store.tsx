import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatRupees } from '@testwise/shared';
import { ArrowDown, ArrowLeft, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Badge, Button, Card, Empty, ErrorBox, Field, fmtDate, fromLocalInput, Input, Modal, PageHeader, Select, statusTone, Table, Textarea, Toggle, toLocalInput, cx } from '../components/ui';
import { api, can } from '../lib/api';
import { useTaxonomy } from '../lib/hooks';

interface SeriesRow {
  id: string; slug: string; titleEn: string; status: string; pricePaise: number; mrpPaise: number | null; color: string; featured: boolean;
  exam: { nameEn: string } | null; _count: { tests: number; enrollments: number };
}

interface Coupon {
  id: string; code: string; descriptionEn: string | null; percentOff: number | null; amountOffPaise: number | null; maxUses: number | null;
  usedCount: number; appliesTo: string; startsAt: string | null; endsAt: string | null; active: boolean;
}

const seriesTone = (s: string) => statusTone(s === 'PUBLISHED' ? 'APPROVED' : s === 'ARCHIVED' ? 'RETIRED' : 'DRAFT');

export function StorePage() {
  const [tab, setTab] = useState<'series' | 'coupons'>('series');
  const navigate = useNavigate();
  const series = useQuery({ queryKey: ['admin-series'], queryFn: () => api<SeriesRow[]>('/v1/admin/store/series') });
  const coupons = useQuery({ queryKey: ['coupons'], queryFn: () => api<Coupon[]>('/v1/admin/store/coupons'), enabled: tab === 'coupons' && can('finance.read') });
  const [editingCoupon, setEditingCoupon] = useState<Partial<Coupon> | null>(null);
  return (
    <>
      <PageHeader
        title="Test series & coupons"
        subtitle="What students can buy or unlock in the Store. Prices, validity, contents and discounts are all set here."
        actions={can('store.write') && (tab === 'series'
          ? <Link to="/store/series/new"><Button><Plus size={16} /> New series</Button></Link>
          : <Button onClick={() => setEditingCoupon({ appliesTo: 'ALL', active: true })}><Plus size={16} /> New coupon</Button>)}
      />
      <div className="mb-4 flex gap-1 rounded-xl bg-gray-100 p-1 text-sm font-semibold w-fit">
        {(['series', 'coupons'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx('rounded-lg px-4 py-1.5', tab === t && 'bg-white shadow')}>{t === 'series' ? 'Test series' : 'Coupons'}</button>
        ))}
      </div>
      {tab === 'series' ? (
        !series.data?.length ? <Empty>No test series yet.</Empty> : (
          <Table head={['Series', 'Status', 'Price', 'Tests', 'Enrolled']}>
            {series.data.map((s) => (
              <tr key={s.id} className="cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/store/series/${s.id}`)}>
                <td className="px-4 py-3"><div className="flex items-center gap-3"><span className="h-9 w-9 rounded-xl" style={{ background: s.color }} /><div><p className="font-semibold">{s.titleEn} {s.featured && <Badge tone="amber">featured</Badge>}</p><p className="text-xs text-gray-400">{s.exam?.nameEn ?? 'All exams'} · /{s.slug}</p></div></div></td>
                <td className="px-4 py-3"><Badge tone={seriesTone(s.status)}>{s.status}</Badge></td>
                <td className="px-4 py-3 text-xs">{s.pricePaise ? formatRupees(s.pricePaise) : 'Free'}{s.mrpPaise ? <span className="ml-1 text-gray-400 line-through">{formatRupees(s.mrpPaise)}</span> : null}</td>
                <td className="px-4 py-3 text-xs tabular-nums">{s._count.tests}</td>
                <td className="px-4 py-3 text-xs tabular-nums">{s._count.enrollments}</td>
              </tr>
            ))}
          </Table>
        )
      ) : !coupons.data?.length ? <Empty>No coupons yet.</Empty> : (
        <Table head={['Code', 'Discount', 'Applies to', 'Used', 'Valid', 'Status', '']}>
          {coupons.data.map((c) => (
            <tr key={c.id}>
              <td className="px-4 py-3 font-mono font-bold">{c.code}<p className="font-sans text-xs font-normal text-gray-400">{c.descriptionEn}</p></td>
              <td className="px-4 py-3 text-sm">{c.percentOff ? `${c.percentOff}%` : formatRupees(c.amountOffPaise ?? 0)}</td>
              <td className="px-4 py-3 text-xs">{c.appliesTo}</td>
              <td className="px-4 py-3 text-xs tabular-nums">{c.usedCount}{c.maxUses ? ` / ${c.maxUses}` : ''}</td>
              <td className="px-4 py-3 text-xs text-gray-500">{c.startsAt ? fmtDate(c.startsAt) : 'now'} → {c.endsAt ? fmtDate(c.endsAt) : 'no end'}</td>
              <td className="px-4 py-3"><Badge tone={c.active ? 'green' : 'gray'}>{c.active ? 'active' : 'off'}</Badge></td>
              <td className="px-4 py-3 text-right">{can('store.write') && <button onClick={() => setEditingCoupon(c)} className="p-1 text-gray-400 hover:text-ink" aria-label="Edit"><Pencil size={14} /></button>}</td>
            </tr>
          ))}
        </Table>
      )}
      {editingCoupon && <CouponForm initial={editingCoupon} onClose={() => setEditingCoupon(null)} />}
    </>
  );
}

function CouponForm({ initial, onClose }: { initial: Partial<Coupon>; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    code: initial.code ?? '', descriptionEn: initial.descriptionEn ?? '', kind: initial.amountOffPaise ? 'amount' : 'percent',
    value: initial.amountOffPaise ? String(initial.amountOffPaise / 100) : String(initial.percentOff ?? ''), maxUses: initial.maxUses ? String(initial.maxUses) : '',
    appliesTo: initial.appliesTo ?? 'ALL', startsAt: initial.startsAt ?? '', endsAt: initial.endsAt ?? '', active: initial.active ?? true,
  });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        code: f.code, descriptionEn: f.descriptionEn || null, percentOff: f.kind === 'percent' ? Number(f.value) : null,
        amountOffPaise: f.kind === 'amount' ? Math.round(Number(f.value) * 100) : null, maxUses: f.maxUses ? Number(f.maxUses) : null,
        appliesTo: f.appliesTo, startsAt: f.startsAt || null, endsAt: f.endsAt || null, active: f.active,
      };
      return initial.id ? api(`/v1/admin/store/coupons/${initial.id}`, { method: 'PUT', json: body }) : api('/v1/admin/store/coupons', { method: 'POST', json: body });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['coupons'] });
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={initial.id ? 'Edit coupon' : 'New coupon'}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="WELCOME50" /></Field>
        <Field label="Applies to"><Select value={f.appliesTo} onChange={(e) => setF({ ...f, appliesTo: e.target.value })}><option value="ALL">Everything</option><option value="SERIES">Test series</option><option value="TOURNAMENT">Tournament entry</option></Select></Field>
        <Field label="Discount type"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="percent">Percentage</option><option value="amount">Fixed ₹</option></Select></Field>
        <Field label={f.kind === 'percent' ? 'Percent off' : 'Rupees off'}><Input type="number" min={1} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>
        <Field label="Max uses (blank = unlimited)"><Input type="number" min={1} value={f.maxUses} onChange={(e) => setF({ ...f, maxUses: e.target.value })} /></Field>
        <Field label="Description"><Input value={f.descriptionEn} onChange={(e) => setF({ ...f, descriptionEn: e.target.value })} /></Field>
        <Field label="Starts"><Input type="datetime-local" value={toLocalInput(f.startsAt)} onChange={(e) => setF({ ...f, startsAt: fromLocalInput(e.target.value) })} /></Field>
        <Field label="Ends"><Input type="datetime-local" value={toLocalInput(f.endsAt)} onChange={(e) => setF({ ...f, endsAt: fromLocalInput(e.target.value) })} /></Field>
        <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Active" />
      </div>
      <div className="mt-4"><ErrorBox error={save.error} /></div>
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button></div>
    </Modal>
  );
}

interface TestOption { id: string; titleEn: string; status: string; kind: string; durationMinutes: number }

export function SeriesEditorPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: tax } = useTaxonomy();
  const writable = can('store.write');
  const [f, setF] = useState({
    slug: '', titleEn: '', titleHi: '', descriptionEn: '', descriptionHi: '', examId: '', price: '0', mrp: '', validityDays: '365',
    color: '#F59E0B', badgeEn: '', badgeHi: '', featured: false, sortOrder: '0',
    features: [] as { en: string; hi: string }[], tests: [] as { test: TestOption; freePreview: boolean }[],
  });
  const [grant, setGrant] = useState({ email: '', days: '30' });

  type Detail = Record<string, unknown> & { status: string; tests: { freePreview: boolean; test: TestOption }[]; _count: { enrollments: number } };
  const { data: s } = useQuery({ queryKey: ['admin-series', id], queryFn: () => api<Detail>(`/v1/admin/store/series/${id}`), enabled: !isNew });
  const tests = useQuery({ queryKey: ['tests', 'PUBLISHED', '', ''], queryFn: () => api<TestOption[]>('/v1/admin/tests?status=PUBLISHED') });

  useEffect(() => {
    if (!s) return;
    const v = (x: unknown) => (x == null ? '' : String(x));
    setF({
      slug: v(s.slug), titleEn: v(s.titleEn), titleHi: v(s.titleHi), descriptionEn: v(s.descriptionEn), descriptionHi: v(s.descriptionHi), examId: v(s.examId),
      price: String(Number(s.pricePaise) / 100), mrp: s.mrpPaise ? String(Number(s.mrpPaise) / 100) : '', validityDays: v(s.validityDays), color: v(s.color),
      badgeEn: v(s.badgeEn), badgeHi: v(s.badgeHi), featured: !!s.featured, sortOrder: v(s.sortOrder),
      features: ((s.features as { en: string; hi?: string | null }[]) ?? []).map((x) => ({ en: x.en, hi: x.hi ?? '' })),
      tests: s.tests.map((t) => ({ test: t.test, freePreview: t.freePreview })),
    });
  }, [s]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        slug: f.slug, titleEn: f.titleEn, titleHi: f.titleHi || null, descriptionEn: f.descriptionEn || null, descriptionHi: f.descriptionHi || null,
        examId: f.examId || null, pricePaise: Math.round(Number(f.price) * 100), mrpPaise: f.mrp ? Math.round(Number(f.mrp) * 100) : null,
        validityDays: Number(f.validityDays), color: f.color, imageUrl: null, badgeEn: f.badgeEn || null, badgeHi: f.badgeHi || null,
        features: f.features.filter((x) => x.en.trim()).map((x) => ({ en: x.en, hi: x.hi || null })), featured: f.featured, sortOrder: Number(f.sortOrder),
        tests: f.tests.map((t) => ({ testId: t.test.id, freePreview: t.freePreview })),
      };
      return isNew ? api<{ id: string }>('/v1/admin/store/series', { method: 'POST', json: body }) : api<{ id: string }>(`/v1/admin/store/series/${id}`, { method: 'PUT', json: body });
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['admin-series'] });
      if (isNew) navigate(`/store/series/${r.id}`, { replace: true });
    },
  });
  const status = useMutation({
    mutationFn: (st: string) => api(`/v1/admin/store/series/${id}/status`, { method: 'POST', json: { status: st } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-series'] }),
  });
  const grantM = useMutation({ mutationFn: () => api(`/v1/admin/store/series/${id}/grant`, { method: 'POST', json: { email: grant.email, days: Number(grant.days) } }), onSuccess: () => setGrant({ email: '', days: '30' }) });

  const available = (tests.data ?? []).filter((t) => !f.tests.some((x) => x.test.id === t.id));
  const move = (i: number, d: -1 | 1) => {
    const next = [...f.tests];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setF({ ...f, tests: next });
  };

  return (
    <>
      <Link to="/store" className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-ink"><ArrowLeft size={14} /> Store</Link>
      <PageHeader title={isNew ? 'New test series' : f.titleEn} subtitle={s ? `${s._count.enrollments} enrolled` : undefined} actions={s && <Badge tone={seriesTone(s.status)}>{s.status}</Badge>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <fieldset disabled={!writable} className="min-w-0 space-y-6">
          <Card title="Listing">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Title (English)"><Input value={f.titleEn} onChange={(e) => setF({ ...f, titleEn: e.target.value, slug: isNew ? e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : f.slug })} /></Field>
              <Field label="शीर्षक (Hindi)"><Input className="hindi" value={f.titleHi} onChange={(e) => setF({ ...f, titleHi: e.target.value })} /></Field>
              <Field label="Slug"><Input value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} /></Field>
              <Field label="Exam"><Select value={f.examId} onChange={(e) => setF({ ...f, examId: e.target.value })}><option value="">All</option>{tax?.exams.map((e) => <option key={e.id} value={e.id}>{e.nameEn}</option>)}</Select></Field>
              <Field label="Description (English)"><Textarea value={f.descriptionEn} onChange={(e) => setF({ ...f, descriptionEn: e.target.value })} /></Field>
              <Field label="विवरण (Hindi)"><Textarea className="hindi" value={f.descriptionHi} onChange={(e) => setF({ ...f, descriptionHi: e.target.value })} /></Field>
              <Field label="Badge (English)"><Input value={f.badgeEn} onChange={(e) => setF({ ...f, badgeEn: e.target.value })} placeholder="Best seller" /></Field>
              <Field label="बैज (Hindi)"><Input className="hindi" value={f.badgeHi} onChange={(e) => setF({ ...f, badgeHi: e.target.value })} /></Field>
              <Field label="Card colour"><Input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className="h-10 p-1" /></Field>
              <div className="flex items-end gap-4 pb-2"><Toggle checked={f.featured} onChange={(v) => setF({ ...f, featured: v })} label="Featured" /><Field label="Sort"><Input type="number" className="w-20" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value })} /></Field></div>
            </div>
          </Card>
          <Card title="Price & access">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Price (₹, 0 = free)"><Input type="number" min={0} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
              <Field label="MRP (₹, shown struck-through)"><Input type="number" min={0} value={f.mrp} onChange={(e) => setF({ ...f, mrp: e.target.value })} /></Field>
              <Field label="Validity (days)"><Input type="number" min={1} value={f.validityDays} onChange={(e) => setF({ ...f, validityDays: e.target.value })} /></Field>
            </div>
          </Card>
          <Card title="Highlights" actions={<Button size="sm" variant="secondary" onClick={() => setF({ ...f, features: [...f.features, { en: '', hi: '' }] })}><Plus size={14} /> Add</Button>}>
            <div className="space-y-2">
              {f.features.map((x, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={x.en} placeholder="English" onChange={(e) => setF({ ...f, features: f.features.map((y, j) => (j === i ? { ...y, en: e.target.value } : y)) })} />
                  <Input value={x.hi} placeholder="हिन्दी" className="hindi" onChange={(e) => setF({ ...f, features: f.features.map((y, j) => (j === i ? { ...y, hi: e.target.value } : y)) })} />
                  <button type="button" onClick={() => setF({ ...f, features: f.features.filter((_, j) => j !== i) })} className="p-2 text-gray-400 hover:text-red-600" aria-label="Remove"><Trash2 size={14} /></button>
                </div>
              ))}
              {!f.features.length && <p className="text-sm text-gray-500">Bullet points shown on the series page.</p>}
            </div>
          </Card>
          <Card title="Tests in this series" actions={
            <Select value="" onChange={(e) => { const t = available.find((x) => x.id === e.target.value); if (t) setF({ ...f, tests: [...f.tests, { test: t, freePreview: false }] }); }} className="max-w-xs">
              <option value="">+ Add a published test…</option>
              {available.map((t) => <option key={t.id} value={t.id}>{t.titleEn} ({t.kind})</option>)}
            </Select>
          }>
            {f.tests.length === 0 ? <p className="text-sm text-gray-500">Add published tests. Mark one as a free preview so students can try before buying.</p> : (
              <ul className="divide-y divide-gray-50">
                {f.tests.map((t, i) => (
                  <li key={t.test.id} className="flex items-center gap-3 py-2">
                    <span className="w-6 text-xs text-gray-400">{i + 1}</span>
                    <p className="flex-1 text-sm font-medium">{t.test.titleEn} <span className="text-xs text-gray-400">· {t.test.kind} · {t.test.durationMinutes} min</span></p>
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={t.freePreview} onChange={(e) => setF({ ...f, tests: f.tests.map((x, j) => (j === i ? { ...x, freePreview: e.target.checked } : x)) })} /> Free preview</label>
                    <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="text-gray-400 disabled:opacity-20" aria-label="Up"><ArrowUp size={14} /></button>
                    <button type="button" disabled={i === f.tests.length - 1} onClick={() => move(i, 1)} className="text-gray-400 disabled:opacity-20" aria-label="Down"><ArrowDown size={14} /></button>
                    <button type="button" onClick={() => setF({ ...f, tests: f.tests.filter((_, j) => j !== i) })} className="text-gray-400 hover:text-red-600" aria-label="Remove"><Trash2 size={14} /></button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <ErrorBox error={save.error} />
          {writable && <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? 'Saving…' : isNew ? 'Create draft' : 'Save changes'}</Button>}
        </fieldset>
        {s && writable && (
          <div className="space-y-6">
            <Card title="Visibility">
              <div className="flex flex-col gap-2">
                {s.status !== 'PUBLISHED' && <Button size="sm" onClick={() => status.mutate('PUBLISHED')}>Publish to Store</Button>}
                {s.status === 'PUBLISHED' && <Button size="sm" variant="secondary" onClick={() => status.mutate('ARCHIVED')}>Archive (hide; existing buyers keep access)</Button>}
                {s.status === 'ARCHIVED' && <Button size="sm" variant="secondary" onClick={() => status.mutate('DRAFT')}>Back to draft</Button>}
              </div>
              <div className="mt-3"><ErrorBox error={status.error} /></div>
            </Card>
            <Card title="Grant access">
              <p className="mb-3 text-xs text-gray-500">Give a student free access (scholarship, support case). Recorded in the audit log.</p>
              <div className="space-y-2">
                <Input placeholder="Student email" value={grant.email} onChange={(e) => setGrant({ ...grant, email: e.target.value })} />
                <Input type="number" min={1} value={grant.days} onChange={(e) => setGrant({ ...grant, days: e.target.value })} />
                <Button size="sm" onClick={() => grantM.mutate()} disabled={!grant.email || grantM.isPending}>Grant</Button>
                {grantM.isSuccess && <p className="text-xs text-emerald-600">Access granted.</p>}
                <ErrorBox error={grantM.error} />
              </div>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
