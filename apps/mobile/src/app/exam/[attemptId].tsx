import { Ionicons } from '@expo/vector-icons';
import type { AttemptPaperDto, PaperQuestion, SavedAnswer } from '@testwise/shared';
import { useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ScreenCapture from 'expo-screen-capture';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, AppState, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Button, ErrorState, Loading, Screen, useFont } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { formatMath } from '../../lib/math';
import { useSession } from '../../lib/session';
import { storage } from '../../lib/storage';
import { cancelLocal, scheduleLocal } from '../../lib/push';
import { useProctoring } from '../../lib/proctor/useProctoring';
import { palette, radius } from '../../theme/tokens';

type Ans = SavedAnswer & { visited: boolean };
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function randomUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function randomSessionId() {
  return `exam-${randomUuid()}`;
}

const status = (a: Ans | undefined) => {
  const answered = !!a && (a.selectedLabels.length > 0 || a.numericValue != null);
  if (a?.markedForReview) return answered ? 'markedAnswered' : 'marked';
  if (answered) return 'answered';
  return a?.visited ? 'notAnswered' : 'notVisited';
};
const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  answered: { bg: palette.green, fg: '#FFFFFF' },
  marked: { bg: palette.violet, fg: '#FFFFFF' },
  markedAnswered: { bg: palette.violet, fg: '#FFFFFF' },
  notAnswered: { bg: '#FEE2E2', fg: '#B91C1C' },
  notVisited: { bg: '#F3F4F6', fg: '#6B7280' },
};

export default function ExamPlayer() {
  const { attemptId } = useLocalSearchParams<{ attemptId: string }>();
  const [paper, setPaper] = useState<AttemptPaperDto | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const p = await api<AttemptPaperDto>(`/v1/attempts/${attemptId}`);
      if (p.status !== 'IN_PROGRESS') {
        router.replace({ pathname: '/result/[attemptId]', params: { attemptId } });
        return;
      }
      setPaper(p);
    } catch (e) {
      setError(e);
    }
  }, [attemptId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <Screen><ErrorState error={error} onRetry={load} /></Screen>;
  if (!paper) return <Screen><Loading /></Screen>;
  return <Player paper={paper} />;
}

function Player({ paper }: { paper: AttemptPaperDto }) {
  const { t } = useTranslation();
  const { config } = useSession();
  const font = useFont();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const qc = useQueryClient();
  const integrity = config?.['exam.integrity'] ?? { gracePeriodSeconds: 20, autosaveIntervalSeconds: 10, warnOnAppBackground: true, autoSubmitAfterBackgroundCount: 0, cameraPreviewEnabled: false, preventScreenshots: false, microphoneLevelMonitoringEnabled: false, microphoneNoiseThresholdDb: -35 };
  const storeKey = `answers:${paper.attemptId}`;

  const [answers, setAnswers] = useState<Record<string, Ans>>(() =>
    Object.fromEntries(paper.answers.map((a) => [a.questionId, { ...a, visited: true }])),
  );
  const [index, setIndex] = useState(0);
  const [lang, setLang] = useState<'EN' | 'HI'>(paper.language);
  const [phase, setPhase] = useState<'instructions' | 'test' | 'submitting'>(paper.answers.length ? 'test' : 'instructions');
  const [offline, setOffline] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [microphonePermissionGranted, setMicrophonePermissionGranted] = useState(false);
  const audioRecorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const audioState = useAudioRecorderState(audioRecorder, 1000);
  const offset = useRef(new Date(paper.serverNow).getTime() - Date.now());
  const deadline = new Date(paper.deadlineAt).getTime();
  const [now, setNow] = useState(Date.now() + offset.current);
  const dirty = useRef(new Set<string>());
  const langDirty = useRef(false);
  const enteredAt = useRef(Date.now());
  const submittingRef = useRef(false);
  const reminderId = useRef<string | null>(null);
  const clientSessionId = useRef(randomSessionId());
  const eventSequence = useRef(0);
  // A proctoring session (device check passed) takes over camera, microphone and screen protection from the older per-exam toggles.
  const proctored = !!paper.proctor;
  const pf = paper.proctor?.features;
  const proctorCamera = pf ? !!(pf.faceCheck || pf.objectDetection) : paper.proctor?.mode === 'AI';
  const cameraRef = useRef<CameraView>(null);
  const cameraPreviewEnabled = !proctored && integrity.cameraPreviewEnabled === true;
  const preventScreenshots = !proctored && integrity.preventScreenshots === true;
  const microphoneLevelMonitoringEnabled = !proctored && integrity.microphoneLevelMonitoringEnabled === true;
  const questions = paper.questions;
  const indexRef = useRef(0);

  const logIntegrityEvent = useCallback(async (type: string, meta?: { enabled?: boolean; signal?: 'FACE_MISSING' | 'MULTIPLE_FACES' | 'CAMERA_BLOCKED' | 'VOICE_DETECTED' | 'ANSWER_SPOKEN' | 'BACKGROUND_NOISE'; confidence?: number }) => {
    const sequence = eventSequence.current++;
    const platform = Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : 'web';
    return api<{ autoSubmitted: boolean; backgroundCount?: number; limit?: number }>(`/v1/attempts/${paper.attemptId}/events`, {
      method: 'POST',
      body: {
        type,
        clientSessionId: clientSessionId.current,
        eventId: randomUuid(),
        sequence,
        clientAt: new Date().toISOString(),
        platform,
        appVersion: Constants.expoConfig?.version ?? null,
        osVersion: Device.osVersion,
        deviceModel: Device.modelName,
        ...(meta && { meta }),
      },
    });
  }, [paper.attemptId]);

  const startExam = useCallback(async () => {
    if (cameraPreviewEnabled) {
      const permission = cameraPermission?.granted ? cameraPermission : await requestCameraPermission();
      await logIntegrityEvent('CAMERA_PERMISSION', { enabled: permission.granted }).catch(() => undefined);
      if (!permission.granted) {
        Alert.alert(
          lang === 'HI' ? 'कैमरा अनुमति आवश्यक है' : 'Camera permission required',
          lang === 'HI' ? 'इस परीक्षा के लिए कैमरा प्रीव्यू आवश्यक है। अनुमति दें या सहायता से संपर्क करें।' : 'This exam requires a camera preview. Grant camera access or contact support if you need an accommodation.',
        );
        return;
      }
    }
    if (microphoneLevelMonitoringEnabled) {
      try {
        const permission = await AudioModule.requestRecordingPermissionsAsync();
        setMicrophonePermissionGranted(permission.granted);
        await logIntegrityEvent('MIC_PERMISSION', { enabled: permission.granted }).catch(() => undefined);
        if (!permission.granted) {
          Alert.alert(
            lang === 'HI' ? 'माइक्रोफ़ोन अनुमति आवश्यक है' : 'Microphone permission required',
            lang === 'HI' ? 'इस परीक्षा के लिए माइक्रोफ़ोन स्तर की निगरानी आवश्यक है। अनुमति दें या सहायता से संपर्क करें।' : 'This exam requires microphone level monitoring. Grant microphone access or contact support if you need an accommodation.',
          );
          return;
        }
      } catch {
        await logIntegrityEvent('MIC_PERMISSION', { enabled: false }).catch(() => undefined);
        Alert.alert(lang === 'HI' ? 'माइक्रोफ़ोन उपलब्ध नहीं' : 'Microphone unavailable', lang === 'HI' ? 'इस डिवाइस पर माइक्रोफ़ोन निगरानी शुरू नहीं हो सकी।' : 'Microphone monitoring could not start on this device.');
        return;
      }
    }
    enteredAt.current = Date.now();
    update(questions[0].id, { visited: true });
    setPhase('test');
  }, [cameraPermission, cameraPreviewEnabled, lang, logIntegrityEvent, microphoneLevelMonitoringEnabled, questions]);

  useEffect(() => {
    if (phase !== 'test' || !microphoneLevelMonitoringEnabled || !microphonePermissionGranted) return;
    let active = true;
    void setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
      .then(() => audioRecorder.prepareToRecordAsync())
      .then(() => { if (active) audioRecorder.record(); })
      .catch(() => { void logIntegrityEvent('MIC_PERMISSION', { enabled: false }).catch(() => undefined); });
    return () => {
      active = false;
      void audioRecorder.stop().catch(() => undefined);
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
    };
  }, [audioRecorder, logIntegrityEvent, microphoneLevelMonitoringEnabled, microphonePermissionGranted, phase]);

  const lastNoiseEventAt = useRef(0);
  useEffect(() => {
    if (phase !== 'test' || !microphoneLevelMonitoringEnabled || !audioState.isRecording || typeof audioState.metering !== 'number') return;
    const threshold = integrity.microphoneNoiseThresholdDb;
    if (audioState.metering < threshold || Date.now() - lastNoiseEventAt.current < 10_000) return;
    lastNoiseEventAt.current = Date.now();
    const confidence = Math.max(0, Math.min(1, (audioState.metering - threshold) / Math.max(1, Math.abs(threshold))));
    void logIntegrityEvent('MIC_SIGNAL', { signal: 'BACKGROUND_NOISE', confidence }).catch(() => undefined);
  }, [audioState.isRecording, audioState.metering, integrity.microphoneNoiseThresholdDb, logIntegrityEvent, microphoneLevelMonitoringEnabled, phase]);

  useEffect(() => {
    if (phase !== 'test' || !preventScreenshots) return;
    const key = `exam-${paper.attemptId}`;
    void ScreenCapture.preventScreenCaptureAsync(key).then(
      () => { void logIntegrityEvent('SCREEN_CAPTURE_STATE', { enabled: true }).catch(() => undefined); },
      () => { void logIntegrityEvent('SCREEN_CAPTURE_STATE', { enabled: false }).catch(() => undefined); },
    );
    let subscription: ScreenCapture.Subscription | undefined;
    void ScreenCapture.getPermissionsAsync().then(async (permission) => {
      if (permission.granted) {
        subscription = ScreenCapture.addScreenshotListener(() => {
          void api(`/v1/attempts/${paper.attemptId}/events`, {
            method: 'POST',
            body: {
              type: 'SCREENSHOT_TAKEN', clientSessionId: clientSessionId.current,
              eventId: randomUuid(), sequence: eventSequence.current++, clientAt: new Date().toISOString(),
              platform: Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : 'web',
              meta: {},
            },
          }).catch(() => undefined);
        });
      }
    }).catch(() => undefined);
    return () => {
      subscription?.remove();
      void ScreenCapture.allowScreenCaptureAsync(key).catch(() => undefined);
      void logIntegrityEvent('SCREEN_CAPTURE_STATE', { enabled: false }).catch(() => undefined);
    };
  }, [logIntegrityEvent, paper.attemptId, phase, preventScreenshots]);

  useEffect(() => {
    void logIntegrityEvent('SESSION_STARTED').catch(() => undefined);
  }, [logIntegrityEvent]);

  const q = questions[index];
  const remaining = Math.max(0, Math.floor((deadline - now) / 1000));
  const sectionOf = (qq: PaperQuestion) => paper.sections.find((s) => s.id === qq.sectionId);
  const text = (en: string | null, hi: string | null) => formatMath(lang === 'HI' && hi ? hi : en);

  // Restore answers saved on this device while offline.
  useEffect(() => {
    void storage.get(storeKey).then((raw) => {
      if (!raw) return;
      const local = JSON.parse(raw) as Record<string, Ans>;
      setAnswers((cur) => ({ ...cur, ...local }));
      Object.keys(local).forEach((id) => dirty.current.add(id));
    });
  }, [storeKey]);

  const persistLocal = useCallback((next: Record<string, Ans>) => {
    const pending = Object.fromEntries([...dirty.current].map((id) => [id, next[id]]).filter(([, v]) => v));
    void storage.set(storeKey, JSON.stringify(pending));
  }, [storeKey]);

  const update = (id: string, patch: Partial<Ans>) => {
    setAnswers((cur) => {
      const base: Ans = cur[id] ?? { questionId: id, selectedLabels: [], numericValue: null, markedForReview: false, timeSpentSec: 0, visited: true };
      const next = { ...cur, [id]: { ...base, ...patch } };
      dirty.current.add(id);
      persistLocal(next);
      return next;
    });
  };

  const answersRef = useRef(answers);
  answersRef.current = answers;

  indexRef.current = index;
  const proctoring = useProctoring({
    attemptId: paper.attemptId,
    proctor: paper.proctor,
    running: phase === 'test',
    camera: cameraRef,
    getProgress: () => {
      const all = Object.values(answersRef.current);
      return {
        questionIndex: indexRef.current,
        answered: all.filter((a) => a.selectedLabels.length > 0 || a.numericValue != null).length,
        marked: all.filter((a) => a.markedForReview).length,
      };
    },
    onWarning: (w) => Alert.alert(lang === 'HI' ? 'निगरानी चेतावनी' : 'Proctor warning', lang === 'HI' ? w.messageHi : w.messageEn),
    onTerminated: (reason) => {
      submittingRef.current = true;
      Alert.alert(lang === 'HI' ? 'टेस्ट समाप्त' : 'Test ended', reason);
      router.replace({ pathname: '/result/[attemptId]', params: { attemptId: paper.attemptId, auto: '1' } });
    },
  });

  const flush = useCallback(async () => {
    if (!dirty.current.size && !langDirty.current) return true;
    const ids = [...dirty.current];
    const payload = ids.map((id) => answersRef.current[id]).filter(Boolean).map(({ visited: _v, ...a }) => a);
    try {
      await api(`/v1/attempts/${paper.attemptId}/answers`, { method: 'PUT', idempotent: true, body: { answers: payload, ...(langDirty.current && { language: lang }) } });
      ids.forEach((id) => dirty.current.delete(id));
      langDirty.current = false;
      persistLocal(answersRef.current);
      setOffline(false);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Time is up or already submitted on the server.
        router.replace({ pathname: '/result/[attemptId]', params: { attemptId: paper.attemptId } });
        return false;
      }
      setOffline(true);
      return false;
    }
  }, [lang, paper.attemptId, persistLocal]);

  // Count time on the current question when leaving it.
  const leaveQuestion = useCallback(() => {
    const spent = Math.round((Date.now() - enteredAt.current) / 1000);
    enteredAt.current = Date.now();
    if (!q || spent <= 0) return;
    const cur = answersRef.current[q.id];
    update(q.id, { timeSpentSec: (cur?.timeSpentSec ?? 0) + spent, visited: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const goTo = (i: number) => {
    if (i < 0 || i >= questions.length) return;
    leaveQuestion();
    setIndex(i);
    const target = questions[i];
    if (!answersRef.current[target.id]?.visited) update(target.id, { visited: true });
    void flush();
  };

  const submit = useCallback(async (auto: boolean) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setPhase('submitting');
    leaveQuestion();
    const payload = Object.values(answersRef.current).map(({ visited: _v, ...a }) => a);
    try {
      await api(`/v1/attempts/${paper.attemptId}/submit`, { method: 'POST', idempotent: true, body: { answers: payload, language: lang } });
      await storage.remove(storeKey);
      void qc.invalidateQueries();
      router.replace({ pathname: '/result/[attemptId]', params: { attemptId: paper.attemptId, auto: auto ? '1' : '0' } });
    } catch (e) {
      submittingRef.current = false;
      setPhase('test');
      setOffline(e instanceof ApiError && e.status === 0);
      Alert.alert(t('common.error'), e instanceof ApiError && e.status === 0 ? t('common.offline') : (e as Error).message);
    }
  }, [lang, leaveQuestion, paper.attemptId, qc, storeKey, t]);

  // Server-synced countdown; auto-submit at zero.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offset.current), 500);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (remaining === 0 && phase !== 'submitting') {
      Alert.alert(t('exam.timeUp'));
      void submit(true);
    }
  }, [remaining, phase, submit, t]);

  // Periodic autosave.
  useEffect(() => {
    if (phase !== 'test') return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      // Spread autosave traffic so a large cohort does not write on the same clock tick.
      const jitteredMs = integrity.autosaveIntervalSeconds * 1000 * (0.85 + Math.random() * 0.3);
      timer = setTimeout(() => {
        void flush();
        schedule();
      }, jitteredMs);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [flush, integrity.autosaveIntervalSeconds, phase]);

  // App switching is logged; the server may auto-submit after the configured limit.
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (phase !== 'test') return;
      if (state === 'background') {
        void flush();
        // Remind the student on this phone 5 minutes before time runs out.
        void scheduleLocal(t('push.examReminderTitle'), t('push.examReminderBody'), new Date(deadline - offset.current - 5 * 60_000), `/exam/${paper.attemptId}`).then((id) => (reminderId.current = id));
        try {
          const r = await logIntegrityEvent('APP_BACKGROUND');
          if (r.autoSubmitted) {
            router.replace({ pathname: '/result/[attemptId]', params: { attemptId: paper.attemptId, auto: '1' } });
          } else if (integrity.warnOnAppBackground) {
            const left = r.limit && r.backgroundCount != null ? r.limit - r.backgroundCount : null;
            setTimeout(() => Alert.alert(t('exam.leftAppTitle'), [t('exam.leftAppBody'), left != null && left > 0 ? t('exam.leftAppLimit', { left }) : ''].filter(Boolean).join('\n\n')), 300);
          }
        } catch {
          /* offline: nothing to log */
        }
      } else if (state === 'active') {
        void cancelLocal(reminderId.current);
        reminderId.current = null;
        void logIntegrityEvent('APP_FOREGROUND').catch(() => undefined);
      }
    });
    return () => sub.remove();
  }, [flush, integrity.warnOnAppBackground, logIntegrityEvent, paper.attemptId, phase, t]);

  // Leaving the screen does not stop the server timer: confirm first.
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (phase !== 'test' || submittingRef.current) return;
      e.preventDefault();
      void flush();
      Alert.alert(t('exam.leftAppTitle'), t('exam.leftAppBody'), [
        { text: t('exam.keepGoing'), style: 'cancel' },
        { text: t('common.back'), style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
      ]);
    });
    return unsub;
  }, [flush, navigation, phase, t]);

  const counts = useMemo(() => {
    const c = { answered: 0, marked: 0, notAnswered: 0, notVisited: 0 };
    for (const qq of questions) {
      const s = status(answers[qq.id]);
      if (s === 'answered' || s === 'markedAnswered') c.answered++;
      if (s === 'marked' || s === 'markedAnswered') c.marked++;
      if (s === 'notAnswered') c.notAnswered++;
      if (s === 'notVisited') c.notVisited++;
    }
    return c;
  }, [answers, questions]);

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');
  const low = remaining < 300;

  if (phase === 'instructions') {
    const totalMarks = questions.reduce((s, x) => s + x.marks, 0);
    return (
      <Screen edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={{ padding: 24, gap: 16, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
          <AppText weight="extrabold" size={24}>{text(paper.titleEn, paper.titleHi)}</AppText>
          <View style={styles.instrStats}>
            {[
              { icon: 'help-circle-outline' as const, v: t('exam.questions', { count: questions.length }) },
              { icon: 'ribbon-outline' as const, v: t('exam.totalMarks', { count: totalMarks }) },
              { icon: 'time-outline' as const, v: `${mm}:${ss}` },
            ].map((s) => (
              <View key={s.icon} style={styles.instrStat}><Ionicons name={s.icon} size={18} color={palette.amber} /><AppText weight="bold" size={13}>{s.v}</AppText></View>
            ))}
          </View>
          {paper.sections.length > 1 && <AppText size={13} muted>{paper.sections.map((s) => (lang === 'HI' && s.titleHi ? s.titleHi : s.titleEn)).join(' · ')}</AppText>}
          <AppText weight="bold" size={16}>{t('exam.instructions')}</AppText>
          <AppText size={14} muted>{text(paper.instructionsEn, paper.instructionsHi)}</AppText>
          <View style={styles.legend}>
            {(['answered', 'notAnswered', 'marked', 'notVisited'] as const).map((k) => (
              <View key={k} style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: STATUS_COLOR[k].bg }]} /><AppText size={12} muted>{t(`exam.${k}`)}</AppText></View>
            ))}
          </View>
          {paper.allowLanguageSwitch && <LangToggle lang={lang} onChange={(l) => { setLang(l); langDirty.current = true; }} />}
        </ScrollView>
        <View style={{ padding: 20, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
          {cameraPreviewEnabled && <View style={{ padding: 14, borderRadius: 12, backgroundColor: '#FFF7E6', gap: 6 }}>
            <AppText weight="bold" size={13}>{lang === 'HI' ? 'कैमरा प्रीव्यू आवश्यक' : 'Camera preview required'}</AppText>
            <AppText size={12} muted>{lang === 'HI' ? 'परीक्षा के दौरान आपका कैमरा इस डिवाइस पर दिखाई देगा। वीडियो रिकॉर्ड या एडमिन को भेजा नहीं जाता।' : 'Your camera preview stays on this device during the exam. Video is not recorded or sent to admins.'}</AppText>
          </View>}
          {preventScreenshots && <AppText size={12} muted>{lang === 'HI' ? 'परीक्षा के दौरान स्क्रीनशॉट ब्लॉक किए जाएंगे।' : 'Screenshots are blocked while the exam is active.'}</AppText>}
          {microphoneLevelMonitoringEnabled && <AppText size={12} muted>{lang === 'HI' ? 'माइक्रोफ़ोन केवल शोर का स्तर मापेगा। ऑडियो रिकॉर्ड या सेव नहीं किया जाएगा।' : 'The microphone measures only coarse noise levels. Audio is not recorded or stored.'}</AppText>}
          <Button title={t('exam.startNow')} onPress={() => { void startExam(); }} />
        </View>
      </Screen>
    );
  }

  const a = answers[q.id];
  const sec = sectionOf(q);

  return (
    <Screen edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel={t('common.back')}><Ionicons name="close" size={24} color="#9CA3AF" /></Pressable>
        <View style={{ flex: 1 }}>
          <AppText weight="extrabold" size={14} numberOfLines={1}>{text(paper.titleEn, paper.titleHi)}</AppText>
          {sec && <AppText weight="bold" size={11} color={palette.green} numberOfLines={1}>{lang === 'HI' && sec.titleHi ? sec.titleHi : sec.titleEn}</AppText>}
        </View>
        {paper.allowLanguageSwitch && <LangToggle compact lang={lang} onChange={(l) => { setLang(l); langDirty.current = true; void flush(); }} />}
        <View style={[styles.timer, low && { backgroundColor: '#FEE2E2' }]} accessibilityLabel="Time left">
          <Ionicons name="time-outline" size={14} color={low ? palette.red : palette.amber} />
          <AppText weight="extrabold" size={13} color={low ? palette.red : palette.amber} style={{ fontVariant: ['tabular-nums'] }}>{mm}:{ss}</AppText>
        </View>
      </View>

      {offline && (
        <View style={styles.offline}><Ionicons name="cloud-offline-outline" size={14} color="#92400E" /><AppText size={12} color="#92400E" style={{ flex: 1 }}>{t('exam.offline')}</AppText></View>
      )}

      {proctoring.live && (
        <View style={[styles.offline, { backgroundColor: '#FEE2E2' }]} accessibilityLiveRegion="polite">
          <View style={[styles.cameraDot, { backgroundColor: '#DC2626' }]} />
          <AppText weight="bold" size={12} color="#991B1B" style={{ flex: 1 }}>{lang === 'HI' ? 'लाइव निगरानी चालू: आपका कैमरा और माइक एक निगरानीकर्ता को दिख/सुन रहे हैं।' : 'LIVE proctoring: your camera and microphone are visible to a proctor.'}</AppText>
        </View>
      )}
      {proctoring.streamIssue && (
        <Modal transparent animationType="fade" visible>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <View style={{ backgroundColor: '#FFF', borderRadius: 20, padding: 22, gap: 12, maxWidth: 420, width: '100%' }}>
              <AppText weight="extrabold" size={18}>{lang === 'HI' ? 'निगरानी स्ट्रीम रुक गई' : 'Proctoring stream stopped'}</AppText>
              <AppText size={14} muted>
                {proctoring.streamIssue === 'screen'
                  ? (lang === 'HI' ? 'स्क्रीन शेयरिंग बंद हो गई। इसकी सूचना निगरानीकर्ता को चली गई है। तुरंत फिर शुरू करें।' : 'Screen sharing stopped and the proctor has been told. Start it again now.')
                  : proctoring.streamIssue === 'camera'
                    ? (lang === 'HI' ? 'कैमरा बंद हो गया। तुरंत फिर चालू करें।' : 'Your camera stopped. Turn it back on now.')
                    : proctoring.streamIssue === 'microphone'
                      ? (lang === 'HI' ? 'माइक बंद हो गया। तुरंत फिर चालू करें।' : 'Your microphone stopped. Turn it back on now.')
                      : (lang === 'HI' ? 'कनेक्शन टूट गया। फिर से जुड़ें।' : 'The connection dropped. Reconnect to continue.')}
              </AppText>
              <Button title={lang === 'HI' ? 'फिर शुरू करें' : 'Resume'} onPress={() => { void proctoring.resumeStream(); }} />
            </View>
          </View>
        </Modal>
      )}
      {(cameraPreviewEnabled || proctorCamera) && !proctoring.live && phase === 'test' && <View style={styles.cameraPreview} accessibilityLabel={lang === 'HI' ? 'कैमरा सक्रिय' : 'Camera active'}>
        <CameraView ref={cameraRef} facing="front" style={StyleSheet.absoluteFill} onCameraReady={() => setCameraReady(true)} onMountError={() => {
          setCameraReady(false);
          void logIntegrityEvent('CAMERA_PERMISSION', { enabled: false }).catch(() => undefined);
        }} />
        <View style={styles.cameraBadge}><View style={[styles.cameraDot, { backgroundColor: cameraReady ? '#16A34A' : '#D97706' }]} /><AppText weight="bold" size={10} color="#FFFFFF">{lang === 'HI' ? 'कैमरा सक्रिय' : 'CAMERA ON'}</AppText></View>
      </View>}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: 'center' }}>
        {questions.map((qq, i) => {
          const c = STATUS_COLOR[status(answers[qq.id])];
          return (
            <Pressable key={qq.id} onPress={() => goTo(i)} style={[styles.stripItem, { backgroundColor: c.bg }, i === index && styles.stripCurrent]} accessibilityLabel={`Question ${i + 1}`}>
              <AppText weight="extrabold" size={11} color={i === index ? palette.ink : c.fg}>{i + 1}</AppText>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, maxWidth: 760, width: '100%', alignSelf: 'center' }}>
        <View style={styles.qHead}>
          <AppText weight="extrabold" size={11} color="#9CA3AF" style={{ letterSpacing: 1, textTransform: 'uppercase' }}>{t('exam.questionOf', { n: index + 1, total: questions.length })}</AppText>
          <AppText weight="bold" size={11} muted>{t('exam.marks', { plus: q.marks, minus: q.negativeMarks })}</AppText>
        </View>
        <AppText weight="bold" size={16} style={{ lineHeight: 26, marginTop: 8 }}>{text(q.textEn, q.textHi)}</AppText>
        {q.imageUrl && <Image source={{ uri: q.imageUrl }} style={styles.qImage} resizeMode="contain" />}

        <View style={{ gap: 12, marginTop: 24 }}>
          {q.type === 'NUMERIC' ? (
            <TextInput
              value={a?.numericValue != null ? String(a.numericValue) : ''}
              onChangeText={(v) => {
                const cleaned = v.replace(/[^0-9.\-]/g, '');
                update(q.id, { numericValue: cleaned === '' || cleaned === '-' || cleaned === '.' ? null : Number(cleaned) });
              }}
              keyboardType="numeric"
              placeholder={t('exam.numericPlaceholder')}
              placeholderTextColor="#9CA3AF"
              style={[styles.numeric, { fontFamily: font('bold') }]}
            />
          ) : (
            q.options.map((o, i) => {
              const selected = a?.selectedLabels.includes(o.label);
              return (
                <Pressable
                  key={o.label}
                  onPress={() => {
                    const cur = a?.selectedLabels ?? [];
                    const next = q.type === 'MCQ_SINGLE' ? (selected ? [] : [o.label]) : selected ? cur.filter((l) => l !== o.label) : [...cur, o.label];
                    update(q.id, { selectedLabels: next });
                  }}
                  style={[styles.option, selected && styles.optionOn]}
                  accessibilityRole={q.type === 'MCQ_SINGLE' ? 'radio' : 'checkbox'}
                  accessibilityState={{ checked: !!selected }}
                >
                  <View style={[styles.optionLetter, selected && { backgroundColor: palette.amber }]}>
                    <AppText weight="extrabold" size={12} color={selected ? '#FFFFFF' : '#6B7280'}>{LETTERS[i]}</AppText>
                  </View>
                  <AppText weight="semibold" size={14} style={{ flex: 1 }}>{text(o.textEn, o.textHi)}</AppText>
                  {q.type === 'MCQ_MULTI' && <Ionicons name={selected ? 'checkbox' : 'square-outline'} size={20} color={selected ? palette.amber : '#D1D5DB'} />}
                </Pressable>
              );
            })
          )}
        </View>

        <View style={styles.qTools}>
          <Pressable onPress={() => update(q.id, { markedForReview: !a?.markedForReview })} style={styles.tool}>
            <Ionicons name={a?.markedForReview ? 'bookmark' : 'bookmark-outline'} size={16} color={palette.violet} />
            <AppText weight="bold" size={13} color={palette.violet}>{a?.markedForReview ? t('exam.unmark') : t('exam.mark')}</AppText>
          </Pressable>
          {(a?.selectedLabels.length || a?.numericValue != null) ? (
            <Pressable onPress={() => update(q.id, { selectedLabels: [], numericValue: null })} style={styles.tool}>
              <Ionicons name="close-circle-outline" size={16} color="#6B7280" />
              <AppText weight="bold" size={13} muted>{t('exam.clear')}</AppText>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: 12 + insets.bottom }]}>
        <Pressable onPress={() => goTo(index - 1)} disabled={index === 0} style={[styles.footBtn, index === 0 && { opacity: 0.3 }]}>
          <Ionicons name="chevron-back" size={18} color="#6B7280" />
          <AppText weight="bold" size={12} muted>{t('exam.prev')}</AppText>
        </Pressable>
        <Pressable onPress={() => setShowPalette(true)} style={styles.footBtn} accessibilityLabel={t('exam.palette')}>
          <Ionicons name="grid-outline" size={18} color="#6B7280" />
        </Pressable>
        {index < questions.length - 1 ? (
          <Button title={t('exam.next')} onPress={() => goTo(index + 1)} size="md" style={{ flex: 1, backgroundColor: palette.green }} />
        ) : (
          <Button title={t('exam.submit')} onPress={() => { void flush(); setConfirmSubmit(true); }} size="md" style={{ flex: 1 }} />
        )}
        {index < questions.length - 1 && (
          <Pressable onPress={() => { void flush(); setConfirmSubmit(true); }} style={styles.footBtn}>
            <AppText weight="extrabold" size={12} color={palette.amber}>{t('exam.submit')}</AppText>
          </Pressable>
        )}
      </View>

      <Modal visible={showPalette} transparent animationType="slide" onRequestClose={() => setShowPalette(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={() => setShowPalette(false)} />
        <View style={[styles.sheet, { paddingBottom: 20 + insets.bottom }]}>
          <AppText weight="extrabold" size={18}>{t('exam.palette')}</AppText>
          <View style={styles.legend}>
            {(['answered', 'notAnswered', 'marked', 'notVisited'] as const).map((k) => (
              <View key={k} style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: STATUS_COLOR[k].bg }]} /><AppText size={12} muted>{t(`exam.${k}`)} ({counts[k]})</AppText></View>
            ))}
          </View>
          <ScrollView style={{ maxHeight: 360 }}>
            {paper.sections.map((s) => (
              <View key={s.id} style={{ marginBottom: 14 }}>
                {paper.sections.length > 1 && <AppText weight="bold" size={13} style={{ marginBottom: 8 }}>{lang === 'HI' && s.titleHi ? s.titleHi : s.titleEn}</AppText>}
                <View style={styles.grid}>
                  {questions.map((qq, i) => qq.sectionId !== s.id ? null : (
                    <Pressable key={qq.id} onPress={() => { setShowPalette(false); goTo(i); }} style={[styles.gridItem, { backgroundColor: STATUS_COLOR[status(answers[qq.id])].bg }, i === index && styles.stripCurrent]}>
                      <AppText weight="extrabold" size={13} color={STATUS_COLOR[status(answers[qq.id])].fg}>{i + 1}</AppText>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={confirmSubmit} transparent animationType="fade" onRequestClose={() => setConfirmSubmit(false)}>
        <View style={styles.center}>
          <View style={styles.dialog}>
            <AppText weight="extrabold" size={20}>{t('exam.submitTitle')}</AppText>
            <AppText size={14} muted style={{ marginVertical: 12 }}>{t('exam.submitBody', { answered: counts.answered, marked: counts.marked, left: questions.length - counts.answered })}</AppText>
            <Button title={t('exam.submitNow')} onPress={() => { setConfirmSubmit(false); void submit(false); }} />
            <Button title={t('exam.keepGoing')} variant="ghost" onPress={() => setConfirmSubmit(false)} style={{ marginTop: 6 }} />
          </View>
        </View>
      </Modal>

      {phase === 'submitting' && (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <View style={[styles.dialog, { alignItems: 'center', gap: 12 }]}>
            <ActivityIndicator color={palette.amber} />
            <AppText weight="bold">{t('exam.submitting')}</AppText>
          </View>
        </View>
      )}
    </Screen>
  );
}

function LangToggle({ lang, onChange, compact }: { lang: 'EN' | 'HI'; onChange: (l: 'EN' | 'HI') => void; compact?: boolean }) {
  return (
    <View style={[styles.langToggle, compact && { paddingVertical: 2 }]}>
      {(['EN', 'HI'] as const).map((l) => (
        <Pressable key={l} onPress={() => onChange(l)} style={[styles.langOpt, lang === l && { backgroundColor: palette.ink }]} accessibilityRole="button" accessibilityState={{ selected: lang === l }}>
          <AppText weight="bold" size={11} color={lang === l ? '#FFFFFF' : '#6B7280'}>{l === 'EN' ? 'EN' : 'हि'}</AppText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F2F4' },
  timer: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFF7E6', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 },
  offline: { flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: '#FEF3C7', paddingHorizontal: 16, paddingVertical: 6 },
  strip: { flexGrow: 0, paddingVertical: 10, backgroundColor: '#FAFAFB', borderBottomWidth: 1, borderBottomColor: '#F4F4F6' },
  stripItem: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  stripCurrent: { borderWidth: 2, borderColor: palette.amber, backgroundColor: '#FFFFFF' },
  qHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  qImage: { width: '100%', height: 200, marginTop: 14, borderRadius: 12, backgroundColor: '#F6F7F9' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: radius.md, borderWidth: 1.5, borderColor: '#EEF0F3', backgroundColor: '#FFFFFF' },
  optionOn: { borderColor: palette.amber, backgroundColor: '#FFFBEB' },
  optionLetter: { width: 32, height: 32, borderRadius: 9, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  numeric: { borderWidth: 1.5, borderColor: '#EEF0F3', borderRadius: radius.md, padding: 16, fontSize: 20, color: palette.ink },
  qTools: { flexDirection: 'row', gap: 20, marginTop: 24 },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F1F2F4', backgroundColor: '#FFFFFF' },
  footBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, height: 42 },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: 20, gap: 14, maxWidth: 640, width: '100%', alignSelf: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 14, height: 14, borderRadius: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  gridItem: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: '#FFFFFF', borderRadius: radius.lg, padding: 22, width: '100%', maxWidth: 420 },
  instrStats: { flexDirection: 'row', gap: 10 },
  cameraPreview: { position: 'absolute', right: 12, top: 68, width: 88, height: 116, overflow: 'hidden', borderRadius: 12, borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: '#111827', zIndex: 10 },
  cameraBadge: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: 'rgba(17,24,39,0.78)', paddingVertical: 4 },
  cameraDot: { width: 6, height: 6, borderRadius: 3 },
  instrStat: { flex: 1, alignItems: 'center', gap: 4, padding: 12, borderRadius: radius.md, backgroundColor: '#F6F7F9' },
  langToggle: { flexDirection: 'row', backgroundColor: '#F3F4F6', borderRadius: 10, padding: 3, alignSelf: 'flex-start' },
  langOpt: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
});
