import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, ErrorBox, Field, fromLocalInput, Input, Modal, PageHeader, Select, Toggle, toLocalInput } from '../components/ui';
import { api, can } from '../lib/api';

interface Banner {
  id: string;
  tagEn: string | null; tagHi: string | null; titleEn: string; titleHi: string | null;
  subtitleEn: string | null; subtitleHi: string | null; ctaEn: string | null; ctaHi: string | null;
  color: string; imageUrl: string | null; linkType: 'NONE' | 'TOURNAMENT' | 'EXAM' | 'SERIES' | 'URL'; linkTarget: string | null;
  sortOrder: number; active: boolean; startsAt: string | null; endsAt: string | null;
}

interface Section { key: string; titleEn: string; titleHi: string | null; enabled: boolean; sortOrder: number }

const SECTION_HELP: Record<string, string> = {
  LIVE_TOURNAMENTS: 'Live and upcoming Test Wars with countdowns',
  CONTINUE_LEARNING: 'In-progress tests and enrolled series progress',
  DAILY_MISSIONS: 'Streak and daily missions (Settings → Daily missions)',
  POPULAR_EXAMS: 'Exam / class shortcuts',
  LEADERBOARD: 'Top students by XP (size set in Settings → XP)',
};

export function CmsPage() {
  const qc = useQueryClient();
  const writable = can('cms.write');
  const banners = useQuery({ queryKey: ['banners'], queryFn: () => api<Banner[]>('/v1/admin/cms/banners') });
  const sectionsQ = useQuery({ queryKey: ['sections'], queryFn: () => api<Section[]>('/v1/admin/cms/sections') });
  const [sections, setSections] = useState<Section[]>([]);
  const [editing, setEditing] = useState<Partial<Banner> | null>(null);
  useEffect(() => sectionsQ.data && setSections(sectionsQ.data), [sectionsQ.data]);

  const saveSections = useMutation({
    mutationFn: () => api('/v1/admin/cms/sections', { method: 'PUT', json: { sections: sections.map((s, i) => ({ ...s, sortOrder: i })) } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sections'] }),
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/v1/admin/cms/banners/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['banners'] }),
  });

  const move = (i: number, d: -1 | 1) => {
    const next = [...sections];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setSections(next);
  };
  const sectionsDirty = JSON.stringify(sections) !== JSON.stringify(sectionsQ.data);

  return (
    <>
      <PageHeader title="Home screen" subtitle="Control the carousel and the order of sections students see on Home." />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card title="Carousel banners" actions={writable && <Button size="sm" onClick={() => setEditing({ color: '#F59E0B', linkType: 'NONE', active: true, sortOrder: banners.data?.length ?? 0 })}><Plus size={14} /> Banner</Button>}>
          <ErrorBox error={del.error} />
          <div className="grid gap-4 sm:grid-cols-2">
            {banners.data?.map((b) => (
              <div key={b.id} className="overflow-hidden rounded-2xl border border-gray-100">
                <div className="relative h-32 p-4 text-white" style={{ background: b.color }}>
                  {b.tagEn && <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold uppercase">{b.tagEn}</span>}
                  <p className="mt-2 text-lg font-extrabold leading-tight">{b.titleEn}</p>
                  <p className="text-xs text-white/80">{b.subtitleEn}</p>
                  {!b.active && <span className="absolute right-3 top-3"><Badge>hidden</Badge></span>}
                </div>
                <div className="flex items-center justify-between p-3 text-xs text-gray-500">
                  <span>#{b.sortOrder} · {b.linkType === 'NONE' ? 'no link' : `${b.linkType.toLowerCase()}: ${b.linkTarget}`}</span>
                  {writable && (
                    <span className="flex gap-1">
                      <button onClick={() => setEditing(b)} className="p-1 hover:text-ink" aria-label="Edit"><Pencil size={14} /></button>
                      <button onClick={() => window.confirm('Delete banner?') && del.mutate(b.id)} className="p-1 hover:text-red-600" aria-label="Delete"><Trash2 size={14} /></button>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Section order">
          <ul className="space-y-2">
            {sections.map((s, i) => (
              <li key={s.key} className="rounded-xl border border-gray-100 p-3">
                <div className="flex items-center gap-2">
                  <div className="flex flex-col">
                    <button disabled={!writable || i === 0} onClick={() => move(i, -1)} className="text-gray-400 hover:text-ink disabled:opacity-20" aria-label="Move up"><ArrowUp size={14} /></button>
                    <button disabled={!writable || i === sections.length - 1} onClick={() => move(i, 1)} className="text-gray-400 hover:text-ink disabled:opacity-20" aria-label="Move down"><ArrowDown size={14} /></button>
                  </div>
                  <div className="flex-1 space-y-1">
                    <Input value={s.titleEn} disabled={!writable} onChange={(e) => setSections(sections.map((x) => (x.key === s.key ? { ...x, titleEn: e.target.value } : x)))} />
                    <Input className="hindi" value={s.titleHi ?? ''} disabled={!writable} onChange={(e) => setSections(sections.map((x) => (x.key === s.key ? { ...x, titleHi: e.target.value } : x)))} />
                  </div>
                  <Toggle checked={s.enabled} disabled={!writable} onChange={(v) => setSections(sections.map((x) => (x.key === s.key ? { ...x, enabled: v } : x)))} />
                </div>
                <p className="mt-1 pl-6 text-xs text-gray-400">{SECTION_HELP[s.key]}</p>
              </li>
            ))}
          </ul>
          <ErrorBox error={saveSections.error} />
          {writable && <Button className="mt-4" size="sm" disabled={!sectionsDirty || saveSections.isPending} onClick={() => saveSections.mutate()}>Save order</Button>}
        </Card>
      </div>
      {editing && <BannerForm initial={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function BannerForm({ initial, onClose }: { initial: Partial<Banner>; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Partial<Banner>>(initial);
  const set = <K extends keyof Banner>(k: K, v: Banner[K]) => setF((p) => ({ ...p, [k]: v }));
  const tournaments = useQuery({ queryKey: ['tournaments', '', ''], queryFn: () => api<{ slug: string; titleEn: string; status: string }[]>('/v1/admin/tournaments') });
  const series = useQuery({ queryKey: ['admin-series'], queryFn: () => api<{ slug: string; titleEn: string; status: string }[]>('/v1/admin/store/series') });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        tagEn: f.tagEn || null, tagHi: f.tagHi || null, titleEn: f.titleEn ?? '', titleHi: f.titleHi || null,
        subtitleEn: f.subtitleEn || null, subtitleHi: f.subtitleHi || null, ctaEn: f.ctaEn || null, ctaHi: f.ctaHi || null,
        color: f.color ?? '#F59E0B', imageUrl: f.imageUrl || null, linkType: f.linkType ?? 'NONE', linkTarget: f.linkTarget || null,
        sortOrder: Number(f.sortOrder ?? 0), active: f.active ?? true, startsAt: f.startsAt || null, endsAt: f.endsAt || null,
      };
      return f.id ? api(`/v1/admin/cms/banners/${f.id}`, { method: 'PUT', json: body }) : api('/v1/admin/cms/banners', { method: 'POST', json: body });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['banners'] });
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={f.id ? 'Edit banner' : 'New banner'} wide>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Tag (English)"><Input value={f.tagEn ?? ''} onChange={(e) => set('tagEn', e.target.value)} placeholder="Limited offer" /></Field>
        <Field label="टैग (Hindi)"><Input className="hindi" value={f.tagHi ?? ''} onChange={(e) => set('tagHi', e.target.value)} /></Field>
        <Field label="Title (English)"><Input value={f.titleEn ?? ''} onChange={(e) => set('titleEn', e.target.value)} /></Field>
        <Field label="शीर्षक (Hindi)"><Input className="hindi" value={f.titleHi ?? ''} onChange={(e) => set('titleHi', e.target.value)} /></Field>
        <Field label="Subtitle (English)"><Input value={f.subtitleEn ?? ''} onChange={(e) => set('subtitleEn', e.target.value)} /></Field>
        <Field label="उपशीर्षक (Hindi)"><Input className="hindi" value={f.subtitleHi ?? ''} onChange={(e) => set('subtitleHi', e.target.value)} /></Field>
        <Field label="Button (English)"><Input value={f.ctaEn ?? ''} onChange={(e) => set('ctaEn', e.target.value)} /></Field>
        <Field label="बटन (Hindi)"><Input className="hindi" value={f.ctaHi ?? ''} onChange={(e) => set('ctaHi', e.target.value)} /></Field>
        <Field label="Opens">
          <Select value={f.linkType ?? 'NONE'} onChange={(e) => set('linkType', e.target.value as Banner['linkType'])}>
            <option value="NONE">Nothing</option><option value="TOURNAMENT">Tournament</option><option value="SERIES">Test series</option><option value="EXAM">Exam</option><option value="URL">Web link</option>
          </Select>
        </Field>
        <Field label="Target">
          {f.linkType === 'SERIES' ? (
            <Select value={f.linkTarget ?? ''} onChange={(e) => set('linkTarget', e.target.value)}>
              <option value="">Select…</option>
              {series.data?.map((s) => <option key={s.slug} value={s.slug}>{s.titleEn} ({s.status})</option>)}
            </Select>
          ) : f.linkType === 'TOURNAMENT' ? (
            <Select value={f.linkTarget ?? ''} onChange={(e) => set('linkTarget', e.target.value)}>
              <option value="">Select…</option>
              {tournaments.data?.map((t) => <option key={t.slug} value={t.slug}>{t.titleEn} ({t.status})</option>)}
            </Select>
          ) : (
            <Input value={f.linkTarget ?? ''} disabled={f.linkType === 'NONE'} onChange={(e) => set('linkTarget', e.target.value)} placeholder={f.linkType === 'URL' ? 'https://…' : 'exam slug'} />
          )}
        </Field>
        <Field label="Show from (optional)"><Input type="datetime-local" value={toLocalInput(f.startsAt)} onChange={(e) => set('startsAt', fromLocalInput(e.target.value) || null)} /></Field>
        <Field label="Show until (optional)"><Input type="datetime-local" value={toLocalInput(f.endsAt)} onChange={(e) => set('endsAt', fromLocalInput(e.target.value) || null)} /></Field>
        <Field label="Background colour"><Input type="color" value={f.color ?? '#F59E0B'} onChange={(e) => set('color', e.target.value)} className="h-10 p-1" /></Field>
        <Field label="Position"><Input type="number" value={f.sortOrder ?? 0} onChange={(e) => set('sortOrder', Number(e.target.value))} /></Field>
        <Toggle checked={f.active ?? true} onChange={(v) => set('active', v)} label="Visible" />
      </div>
      <div className="mt-4"><ErrorBox error={save.error} /></div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
      </div>
    </Modal>
  );
}
