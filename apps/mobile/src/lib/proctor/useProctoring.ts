import {
  DEFAULT_ACCESSIBILITY_ALLOWLIST,
  resolveFeatures,
  type ProctorFeatures,
  matchAnswerSpeech,
  type IntegrityReport,
  type ProctorFlagType,
  type ProctorMode,
  type PublicAppConfig,
} from '@testwise/shared';
import FaceDetection from '@react-native-ml-kit/face-detection';
import type { CameraView } from 'expo-camera';
import * as ScreenCapture from 'expo-screen-capture';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { AppState, Platform } from 'react-native';
import { io, type Socket } from 'socket.io-client';
import { API_URL, api, freshAccessToken } from '../api';
import { attest, fetchChallenge } from './attest';
import { sendFlag, sendSnapshot } from './flags';
import { installId } from './identity';
import { disconnectLive, isLive, isScreenSharing, onLiveEvent, rejoinLive, resumeSource, type LiveSource } from './live';
import ImageLabeling from '@react-native-ml-kit/image-labeling';
import { collectIntegrity, nativeIntegrity } from './report';
import { useSession } from '../session';

type Policy = PublicAppConfig['proctoring.policy'];

export interface ProctorWarning {
  messageEn: string;
  messageHi: string;
  fromProctor: boolean;
}

interface Options {
  attemptId: string;
  /** From the paper DTO: null when the attempt is not proctored. */
  proctor: { mode: ProctorMode; status: string; liveRequested: boolean; features: ProctorFeatures | null } | null;
  /** True once the student is answering questions (not on the instructions screen). */
  running: boolean;
  camera: RefObject<CameraView | null>;
  getProgress(): { questionIndex: number | null; answered: number; marked: number };
  onWarning(w: ProctorWarning): void;
  onTerminated(reason: string): void;
}

const ALLOWED_A11Y = new Set(DEFAULT_ACCESSIBILITY_ALLOWLIST);
const PHONE_LABELS = ['mobile phone', 'telephone', 'smartphone', 'cell phone', 'iphone', 'gadget phone'];
const OBJECT_LABELS = ['book', 'notebook', 'laptop', 'tablet computer', 'netbook', 'computer monitor', 'television', 'handwriting', 'paper'];

/**
 * Runtime proctoring for one attempt: secure surface (black screenshots/recordings/casts), live device integrity,
 * heartbeat + warnings over the /proctor socket, periodic platform re-attestation, camera face checks, spoken-answer
 * detection and (when a proctor asks) live streaming. Every detector only REPORTS; scoring, warnings, termination and
 * bans are decided on the server and by humans.
 */
export function useProctoring(o: Options) {
  const { user } = useSession();
  const { config } = useSession();
  const policy: Policy | undefined = config?.['proctoring.policy'];
  const active = !!o.proctor && o.proctor.status === 'ACTIVE' && o.running && !!policy;
  const mode = o.proctor?.mode ?? 'OFF';
  // Sessions opened before per-exam switches existed carry no features: fall back to the mode preset.
  const features: ProctorFeatures = o.proctor?.features ?? resolveFeatures(mode, {}, { speechDetection: true, objectDetection: true, requireScreenShare: true, liveEnabled: true, instantDisqualifyFlags: [], autoSubmitRules: [] });
  const camMode = features.faceCheck || features.objectDetection || features.speech || features.liveStream;
  const streaming = features.liveStream;

  const [live, setLive] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [streamIssue, setStreamIssue] = useState<LiveSource | 'disconnected' | null>(null);
  const [faces, setFaces] = useState<number | null>(null);
  const opts = useRef(o);
  useEffect(() => { opts.current = o; });
  const facesRef = useRef<number | null>(null);
  const noiseRef = useRef<number | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const flag = useCallback((type: ProctorFlagType, confidence: number | null, details: Record<string, unknown> = {}, evidenceUri?: string) => {
    void sendFlag(opts.current.attemptId, { type, confidence, details: details as never }, evidenceUri ? [{ uri: evidenceUri, name: 'e.jpg', type: 'image/jpeg' }] : []).catch(() => undefined);
  }, []);

  // ---- Secure surface: screenshots, recordings, casts and screen sharing show black. ----
  useEffect(() => {
    // While the screen is shared with the proctor the protection must be off (a protected window shares as black).
    if (!active || sharing) return;
    const key = `proctor-${o.attemptId}`;
    const mod = nativeIntegrity();
    void ScreenCapture.preventScreenCaptureAsync(key).catch(() => undefined);
    mod?.setSecure(true);
    let shot: ScreenCapture.Subscription | undefined;
    void ScreenCapture.getPermissionsAsync().then((p) => {
      if (p.granted) shot = ScreenCapture.addScreenshotListener(() => flag('SCREENSHOT', 1));
    }).catch(() => undefined);
    const watch = mod?.addListener('onCaptureState', (e) => { if (e.recording) flag('SCREEN_RECORDING', 1); });
    mod?.startCaptureWatch();
    return () => {
      shot?.remove();
      watch?.remove();
      mod?.stopCaptureWatch();
      mod?.setSecure(false);
      void ScreenCapture.allowScreenCaptureAsync(key).catch(() => undefined);
    };
  }, [active, sharing, o.attemptId, flag]);

  // ---- Device integrity, re-read every heartbeat; a flag is sent when a bad state starts (and again at most once a minute). ----
  const lastSent = useRef<Record<string, number>>({});
  const checkIntegrity = useCallback(async (): Promise<Partial<IntegrityReport> | null> => {
    if (!policy) return null;
    let r: IntegrityReport;
    try {
      r = await collectIntegrity();
    } catch {
      return null;
    }
    const once = (type: ProctorFlagType, bad: boolean, details: Record<string, unknown> = {}) => {
      if (!bad) {
        delete lastSent.current[type];
        return;
      }
      const now = Date.now();
      if (lastSent.current[type] && now - lastSent.current[type] < 60_000) return;
      lastSent.current[type] = now;
      flag(type, 1, details);
    };
    once('ROOTED_DEVICE', r.rooted);
    once('EMULATOR', r.emulator);
    once('USB_DEBUGGING', r.usbDebugging);
    once('REMOTE_APP', r.remoteApps.length > 0, { packages: r.remoteApps.map((a) => a.packageId).slice(0, 20) });
    once('ACCESSIBILITY_SERVICE', r.accessibilityServices.some((s) => !ALLOWED_A11Y.has(s.split('/')[0])));
    once('EXTERNAL_DISPLAY', r.externalDisplays > 0);
    once('SPLIT_SCREEN', r.multiWindow);
    once('SCREEN_RECORDING', r.screenCaptured);
    once('APP_TAMPERED', !!r.hooked || !!r.sideloaded, { reasons: [r.hooked ? 'hooking framework' : '', r.sideloaded ? 'not installed from the store' : ''].filter(Boolean) });
    if (camMode) once('HEADPHONES', r.headphones);
    return { rooted: r.rooted, emulator: r.emulator, usbDebugging: r.usbDebugging, screenCaptured: r.screenCaptured, externalDisplays: r.externalDisplays, headphones: r.headphones, multiWindow: r.multiWindow, remoteApps: r.remoteApps, accessibilityServices: r.accessibilityServices };
  }, [policy, camMode, flag]);

  // ---- Re-attestation ----
  const reattesting = useRef(false);
  const reattest = useCallback(async () => {
    if (!policy || !user || reattesting.current) return;
    reattesting.current = true;
    try {
      const c = await fetchChallenge();
      const evidence = await attest(user.id, c.challenge, policy);
      await api(`/v1/proctor/attempts/${opts.current.attemptId}/reattest`, { method: 'POST', body: { challengeId: c.challengeId, attestation: evidence } });
    } catch {
      /* the server flags a missing/failed proof only when it receives one; an offline phone is covered by CONNECTION_LOST */
    } finally {
      reattesting.current = false;
    }
  }, [policy, user]);

  // ---- Streaming to proctors (LIVE): started at the consent screen; here we only watch its health and rejoin after a restart. ----
  useEffect(() => {
    if (!active || !streaming) return;
    let stopped = false;
    const sources = { camera: true, microphone: true, screen: features.screenShare && Platform.OS === 'android' };
    const sync = () => { setLive(isLive()); setSharing(isScreenSharing()); };
    if (!isLive()) void rejoinLive(opts.current.attemptId, sources).then((r) => { if (!stopped) { if (!r.ok) setStreamIssue(r.failed === 'connect' ? 'disconnected' : r.failed); sync(); } }).catch(() => { if (!stopped) setStreamIssue('disconnected'); });
    sync();
    const off = onLiveEvent((e) => {
      if (e.type === 'stopped') {
        setStreamIssue(e.source);
        flag(e.source === 'screen' ? 'SCREEN_SHARE_STOPPED' : 'CAMERA_STOPPED', 1, { reasons: [e.source] });
      } else if (e.type === 'disconnected') setStreamIssue('disconnected');
      else setStreamIssue(null);
      sync();
    });
    return () => { stopped = true; off(); };
  }, [active, streaming, features.screenShare, flag]);

  const resumeStream = useCallback(async () => {
    const issue = streamIssue;
    if (!issue) return;
    if (issue === 'disconnected') {
      const r = await rejoinLive(opts.current.attemptId, { camera: true, microphone: true, screen: features.screenShare && Platform.OS === 'android' });
      if (r.ok) { setStreamIssue(null); setLive(isLive()); setSharing(isScreenSharing()); }
      return;
    }
    if (await resumeSource(issue)) { setStreamIssue(null); setSharing(isScreenSharing()); }
  }, [streamIssue, features.screenShare]);

  // ---- Socket: heartbeat, warnings, termination, live requests ----
  useEffect(() => {
    if (!active || !policy) return;
    let stopped = false;
    const socket = io(`${API_URL}/proctor`, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      auth: (cb) => { void freshAccessToken().then((token) => cb({ token, attemptId: opts.current.attemptId })); },
    });
    socketRef.current = socket;
    socket.on('proctor:warning', (w: ProctorWarning) => opts.current.onWarning(w));
    socket.on('proctor:terminated', (e: { reason: string }) => opts.current.onTerminated(e.reason));

    const beat = async () => {
      if (stopped) return;
      const integrity = await checkIntegrity();
      const p = opts.current.getProgress();
      socket.timeout(5000).emit(
        'hb',
        { appState: AppState.currentState === 'active' ? 'active' : AppState.currentState === 'background' ? 'background' : 'inactive', ...p, faces: facesRef.current, noiseLevel: noiseRef.current, ...(integrity && { integrity }), deviceId: await installId() },
        (err: unknown, ack?: { ok?: boolean; liveRequested?: boolean; reattestDue?: boolean; status?: string }) => {
          if (err || !ack) return;
          if (ack.status && ack.status !== 'ACTIVE') opts.current.onTerminated('session ended');
          if (ack.reattestDue) void reattest();
        },
      );
    };
    void beat();
    const timer = setInterval(() => void beat(), Math.max(5, policy.heartbeatSeconds) * 1000);
    const appSub = AppState.addEventListener('change', (s) => { if (s === 'background') flag('APP_SWITCH', 1); });
    return () => {
      stopped = true;
      clearInterval(timer);
      appSub.remove();
      socket.disconnect();
      socketRef.current = null;
      void disconnectLive();
    };
  }, [active, policy, checkIntegrity, reattest, flag]);

  // ---- Camera: face presence, second person, looking away, wall snapshots (paused while a proctor streams the camera) ----
  useEffect(() => {
    if (!active || !(features.faceCheck || features.objectDetection) || !policy || live) return;
    const detectFaces = features.faceCheck;
    const detectObjects = features.objectDetection && policy.objectDetection;
    let stopped = false;
    let busy = false;
    let missingSince: number | null = null;
    let awaySince: number | null = null;
    let failures = 0;
    let lastSnapshot = 0;
    const flagged: Record<string, number> = {};
    const throttled = (type: ProctorFlagType, ms: number, send: () => void) => {
      const now = Date.now();
      if (flagged[type] && now - flagged[type] < ms) return;
      flagged[type] = now;
      send();
    };
    const tick = async () => {
      const cam = opts.current.camera.current;
      if (stopped || busy || !cam || AppState.currentState !== 'active') return;
      busy = true;
      try {
        const pic = await cam.takePictureAsync({ quality: 0.35, skipProcessing: true, shutterSound: false });
        failures = 0;
        // Faces and objects are read from the same frame in parallel so a phone is caught within one interval.
        const [found, labels] = await Promise.all([
          detectFaces && pic?.uri ? FaceDetection.detect(pic.uri, { performanceMode: 'fast' }) : Promise.resolve([]),
          detectObjects && pic?.uri ? ImageLabeling.label(pic.uri).catch(() => []) : Promise.resolve([]),
        ]);
        const now = Date.now();
        if (detectObjects) {
          const hit = (names: string[]) => labels.filter((l) => l.confidence >= policy.objectConfidence && names.some((n) => l.text.toLowerCase().includes(n)));
          const phones = hit(PHONE_LABELS);
          const others = hit(OBJECT_LABELS);
          if (phones.length) throttled('PHONE_DETECTED', 15_000, () => flag('PHONE_DETECTED', Math.max(...phones.map((l) => l.confidence)), { objects: phones.map((l) => ({ label: l.text.slice(0, 60), confidence: l.confidence })).slice(0, 10) }, pic.uri));
          else if (others.length) throttled('OBJECT_DETECTED', 30_000, () => flag('OBJECT_DETECTED', Math.max(...others.map((l) => l.confidence)), { objects: others.map((l) => ({ label: l.text.slice(0, 60), confidence: l.confidence })).slice(0, 10) }, pic.uri));
        }
        if (!detectFaces) {
          if (now - lastSnapshot >= policy.wallSnapshotSeconds * 1000 && pic?.uri) {
            lastSnapshot = now;
            void sendSnapshot(opts.current.attemptId, { uri: pic.uri, name: 's.jpg', type: 'image/jpeg' }, null).catch(() => undefined);
          }
          return;
        }
        facesRef.current = found.length;
        setFaces(found.length);
        missingSince = found.length === 0 ? missingSince ?? now : null;
        const first = found[0];
        const away = !!first && Math.abs(first.rotationY) > policy.lookAwayDegrees;
        awaySince = away ? awaySince ?? now : null;

        if (missingSince && now - missingSince >= policy.faceMissingSeconds * 1000) throttled('FACE_MISSING', 30_000, () => flag('FACE_MISSING', 0.9, { faces: 0, durationSec: Math.round((now - missingSince!) / 1000) }, pic.uri));
        if (found.length > 1) throttled('MULTIPLE_FACES', 30_000, () => flag('MULTIPLE_FACES', 0.9, { faces: found.length }, pic.uri));
        if (awaySince && now - awaySince >= policy.lookAwaySeconds * 1000) throttled('LOOKING_AWAY', 30_000, () => flag('LOOKING_AWAY', 0.7, { yaw: Math.round(first.rotationY), durationSec: Math.round((now - awaySince!) / 1000) }));
        if (now - lastSnapshot >= policy.wallSnapshotSeconds * 1000 && pic?.uri) {
          lastSnapshot = now;
          void sendSnapshot(opts.current.attemptId, { uri: pic.uri, name: 's.jpg', type: 'image/jpeg' }, found.length).catch(() => undefined);
        }
      } catch {
        if (++failures >= 3) throttled('CAMERA_BLOCKED', 60_000, () => flag('CAMERA_BLOCKED', 0.6));
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => void tick(), Math.max(0.5, policy.faceCheckIntervalSeconds) * 1000);
    return () => { stopped = true; clearInterval(timer); };
  }, [active, features.faceCheck, features.objectDetection, policy, live, flag]);

  // ---- Speech: spoken answers, talking, loud surroundings. Only matched moments are sent (never a full transcript). ----
  useEffect(() => {
    if (!active || !features.speech || !policy?.speechDetection || live || Platform.OS === 'web') return;
    let stopped = false;
    let loudSince: number | null = null;
    const last: Record<string, number> = {};
    const quiet = (type: string, ms: number) => {
      const now = Date.now();
      if (last[type] && now - last[type] < ms) return false;
      last[type] = now;
      return true;
    };
    const start = () => {
      if (stopped) return;
      try {
        ExpoSpeechRecognitionModule.start({
          lang: policy.speechLocale,
          interimResults: true,
          continuous: true,
          requiresOnDeviceRecognition: ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
          volumeChangeEventOptions: { enabled: true, intervalMillis: 500 },
        });
      } catch {
        /* speech engine unavailable on this device: other signals still run */
      }
    };
    const subs = [
      ExpoSpeechRecognitionModule.addListener('result', (e) => {
        const text = e.results[0]?.transcript ?? '';
        if (!text) return;
        const matched = matchAnswerSpeech(text, policy.answerPatterns);
        if (matched) {
          if (quiet('ANSWER_SPOKEN', 20_000)) flag('ANSWER_SPOKEN', e.results[0]?.confidence ?? 0.7, { transcript: text.slice(0, 200), matchedPattern: matched.slice(0, 200) });
        } else if (e.isFinal && text.trim().split(/\s+/).length >= policy.voiceMinWords && quiet('VOICE_DETECTED', 30_000)) {
          flag('VOICE_DETECTED', e.results[0]?.confidence ?? 0.6);
        }
      }),
      ExpoSpeechRecognitionModule.addListener('volumechange', (e) => {
        noiseRef.current = e.value;
        // value is roughly 0..10; louder than the admin threshold for noiseSeconds is reported (no audio is kept).
        if (e.value >= policy.noiseLevel) {
          loudSince ??= Date.now();
          if (Date.now() - loudSince >= policy.noiseSeconds * 1000 && quiet('BACKGROUND_NOISE', 60_000)) flag('BACKGROUND_NOISE', Math.min(1, e.value / 10), { level: e.value });
        } else loudSince = null;
      }),
      ExpoSpeechRecognitionModule.addListener('end', () => { if (!stopped) setTimeout(start, 400); }), // continuous sessions end on silence/timeouts: restart
      ExpoSpeechRecognitionModule.addListener('error', (e) => {
        if (stopped) return;
        if (e.error === 'not-allowed') flag('PERMISSION_REVOKED', 1);
      }),
    ];
    start();
    return () => {
      stopped = true;
      subs.forEach((s) => s.remove());
      try { ExpoSpeechRecognitionModule.abort(); } catch { /* not running */ }
    };
  }, [active, features.speech, policy, live, flag]);

  return { live, sharing, faces, active, streamIssue, resumeStream, features };
}
