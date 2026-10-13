import { resolveFeatures } from '@testwise/shared';

const policy = { speechDetection: true, objectDetection: true, requireScreenShare: true, liveEnabled: true, instantDisqualifyFlags: ['PHONE_DETECTED'], autoSubmitRules: [{}] };

describe('resolveFeatures', () => {
  it('OFF turns everything off', () => expect(Object.values(resolveFeatures('OFF', { faceCheck: true }, policy)).some(Boolean)).toBe(false));
  it('BASIC is the simple mode: only the connection check', () => {
    const f = resolveFeatures('BASIC', {}, policy);
    expect(Object.entries(f).filter(([, v]) => v).map(([k]) => k).sort()).toEqual(['autoSubmit', 'connectionCheck']);
  });
  it('AI enables on-device detectors', () => {
    const f = resolveFeatures('AI', {}, policy);
    expect([f.faceCheck, f.objectDetection, f.speech, f.liveStream]).toEqual([true, true, true, false]);
  });
  it('an exam can switch single features off or on', () => {
    expect(resolveFeatures('AI', { objectDetection: false, speech: false }, policy)).toMatchObject({ faceCheck: true, objectDetection: false, speech: false });
    expect(resolveFeatures('BASIC', { faceCheck: true, instantDisqualify: true }, policy)).toMatchObject({ faceCheck: true, instantDisqualify: true });
  });
  it('LIVE streams and steps the local camera/mic detectors aside', () => {
    const f = resolveFeatures('LIVE', { faceCheck: true, speech: true }, policy);
    expect([f.liveStream, f.screenShare, f.faceCheck, f.speech, f.objectDetection]).toEqual([true, true, false, false, false]);
  });
  it('the global policy is a ceiling an exam cannot exceed', () => {
    const f = resolveFeatures('AI', { instantDisqualify: true }, { ...policy, objectDetection: false, speechDetection: false, instantDisqualifyFlags: [], autoSubmitRules: [] });
    expect([f.objectDetection, f.speech, f.instantDisqualify]).toEqual([false, false, false]);
    expect(resolveFeatures('LIVE', {}, { ...policy, liveEnabled: false }).liveStream).toBe(false);
  });
});
