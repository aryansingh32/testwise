import { useMemo } from 'react';
import { Field, Input } from './ui';

export interface EligibilityForm {
  audience: ('SCHOOL' | 'EXAM')[];
  classLevels: number[];
  examIds: string[];
  minAge: string;
  maxAge: string;
}

type Who = 'EVERYONE' | 'SCHOOL' | 'EXAM';

const whoOf = (v: EligibilityForm): Who => (v.audience.length === 1 ? v.audience[0] : 'EVERYONE');

/**
 * "Who can join" as one explicit choice instead of an empty-means-everyone convention.
 *  Everyone: no restriction at all.  School students: optionally only some classes.
 *  Exam aspirants: optionally only students preparing for chosen exams.  Age limits apply on top.
 * The server re-checks all of this from the student's profile; the app is never trusted.
 */
export function AudiencePicker({ value, onChange, exams }: { value: EligibilityForm; onChange: (v: EligibilityForm) => void; exams: { id: string; nameEn: string }[] }) {
  const who = whoOf(value);
  const summary = useMemo(() => {
    if (who === 'EVERYONE') return 'Open to every student, any class, any exam.';
    if (who === 'SCHOOL') return value.classLevels.length ? `School students in Class ${[...value.classLevels].sort((a, b) => a - b).join(', ')} only.` : 'All school students, any class.';
    return value.examIds.length ? `Exam aspirants preparing for ${value.examIds.map((id) => exams.find((e) => e.id === id)?.nameEn ?? id).join(', ')}.` : 'All exam aspirants, any exam.';
  }, [who, value, exams]);
  const choose = (w: Who) =>
    onChange({ ...value, audience: w === 'EVERYONE' ? [] : [w], classLevels: w === 'SCHOOL' ? value.classLevels : [], examIds: w === 'EXAM' ? value.examIds : [] });
  const toggle = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Who can join">
        {([['EVERYONE', 'Everyone'], ['SCHOOL', 'School students'], ['EXAM', 'Exam aspirants']] as const).map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={who === k} onClick={() => choose(k)} className={`rounded-xl px-4 py-2 text-sm font-semibold ${who === k ? 'bg-ink text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>{label}</button>
        ))}
      </div>
      {who === 'SCHOOL' && (
        <Field label="Classes" hint="None selected = every class">
          <div className="flex flex-wrap gap-1.5 pt-1">
            {[6, 7, 8, 9, 10, 11, 12].map((c) => (
              <button type="button" key={c} onClick={() => onChange({ ...value, classLevels: toggle(value.classLevels, c) })} className={`h-8 w-10 rounded-lg text-xs font-bold ${value.classLevels.includes(c) ? 'bg-brand-500 text-white' : 'bg-gray-100'}`}>{c}</button>
            ))}
          </div>
        </Field>
      )}
      {who === 'EXAM' && (
        <Field label="Exams" hint="None selected = any exam. A student matches if they picked at least one.">
          <div className="flex flex-wrap gap-1.5 pt-1">
            {exams.map((e) => (
              <button type="button" key={e.id} onClick={() => onChange({ ...value, examIds: toggle(value.examIds, e.id) })} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${value.examIds.includes(e.id) ? 'bg-brand-500 text-white' : 'bg-gray-100'}`}>{e.nameEn}</button>
            ))}
          </div>
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Minimum age (optional)"><Input type="number" value={value.minAge} onChange={(e) => onChange({ ...value, minAge: e.target.value })} /></Field>
        <Field label="Maximum age (optional)"><Input type="number" value={value.maxAge} onChange={(e) => onChange({ ...value, maxAge: e.target.value })} /></Field>
      </div>
      <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600"><b>Who can join:</b> {summary}</p>
    </div>
  );
}

export const eligibilityToApi = (v: EligibilityForm) => ({
  audience: v.audience, classLevels: v.classLevels, examIds: v.examIds,
  minAge: v.minAge === '' ? null : Number(v.minAge), maxAge: v.maxAge === '' ? null : Number(v.maxAge),
});
export const eligibilityFromApi = (e: Record<string, unknown> | undefined): EligibilityForm => ({
  audience: ((e?.audience as EligibilityForm['audience']) ?? []).slice(0, 1), classLevels: (e?.classLevels as number[]) ?? [], examIds: (e?.examIds as string[]) ?? [],
  minAge: e?.minAge == null ? '' : String(e.minAge), maxAge: e?.maxAge == null ? '' : String(e.maxAge),
});
