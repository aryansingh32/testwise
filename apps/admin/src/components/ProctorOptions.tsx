import { PROCTOR_FEATURES, PROCTOR_FEATURE_INFO, resolveFeatures, type ProctorFeature, type ProctorMode, type ProctorOptions } from '@testwise/shared';

const OPEN = { speechDetection: true, objectDetection: true, requireScreenShare: true, liveEnabled: true, instantDisqualifyFlags: ['x'], autoSubmitRules: ['x'] };

/**
 * Per-exam switches on top of the mode preset. Only differences from the preset are stored, so changing the mode
 * keeps working. The global policy (Settings → Proctoring) can still switch a feature off for every exam.
 */
export function ProctorOptionsEditor({ mode, value, onChange }: { mode: ProctorMode; value: ProctorOptions; onChange: (v: ProctorOptions) => void }) {
  if (mode === 'OFF') return null;
  const preset = resolveFeatures(mode, {}, OPEN);
  const effective = resolveFeatures(mode, value, OPEN);
  const toggle = (k: ProctorFeature, on: boolean) => {
    const next = { ...value };
    if (on === preset[k]) delete next[k];
    else next[k] = on;
    onChange(next);
  };
  return (
    <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Checks for this exam</p>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        {PROCTOR_FEATURES.map((k) => (
          <label key={k} className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={effective[k]} onChange={(e) => toggle(k, e.target.checked)} />
            <span>
              <span className="font-semibold">{PROCTOR_FEATURE_INFO[k].label}</span>
              <span className="block text-xs text-gray-500">{PROCTOR_FEATURE_INFO[k].hint}</span>
            </span>
          </label>
        ))}
      </div>
      {mode === 'LIVE' && value.faceCheck && <p className="mt-2 text-xs text-amber-700">Face, object and speech checks are skipped while live streaming is on.</p>}
      <p className="mt-2 text-xs text-gray-500">Settings → Proctoring can still switch a feature off for all exams.</p>
    </div>
  );
}
