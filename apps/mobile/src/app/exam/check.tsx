import { Ionicons } from '@expo/vector-icons';
import {
  FLAG_TYPES,
  type AttemptPaperDto,
  type PreflightResultDto,
  type ProctorFeatures,
  type ProctorFlagType,
  type ProctorPreflightInput,
} from '@testwise/shared';
import FaceDetection from '@react-native-ml-kit/face-detection';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { AudioModule } from 'expo-audio';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText, Button, Card, Screen } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { attest, confirmAttestedKey, fetchChallenge, forgetAttestedKey } from '../../lib/proctor/attest';
import { connectLive, disconnectLive } from '../../lib/proctor/live';
import { measureNetwork, type NetworkResult } from '../../lib/proctor/netcheck';
import { collectDevice, collectIntegrity } from '../../lib/proctor/report';
import { useSession } from '../../lib/session';
import { palette } from '../../theme/tokens';

type Step = 'consent' | 'checking' | 'blocked' | 'starting';

const TEXT_VERSION = 'consent-2026-10-b';

/**
 * The one consent screen, shown once before the exam. It explains what each permission is for, asks for them together,
 * measures the connection, verifies the device, starts the camera/mic/screen stream when the exam uses one (so the OS
 * prompts happen here, not mid-exam), and only then starts the attempt and its timer.
 */
export default function DeviceCheck() {
  const { kind, ref, features: featuresParam } = useLocalSearchParams<{ kind: 'test' | 'tournament'; ref: string; mode: string; features: string }>();
  const features = (featuresParam ? JSON.parse(featuresParam) : {}) as Partial<ProctorFeatures>;
  const { config, user, language } = useSession();
  const hi = language === 'HI';
  const tx = (en: string, hindi: string) => (hi ? hindi : en);
  const policy = config?.['proctoring.policy'];

  const needCamera = !!(features.faceCheck || features.objectDetection || features.liveStream);
  const needMic = !!(features.speech || features.liveStream);
  const needScreen = !!features.screenShare && Platform.OS === 'android';
  const instant = !!features.instantDisqualify && !!policy?.instantDisqualifyFlags.length;

  const [step, setStep] = useState<Step>('consent');
  const [agreed, setAgreed] = useState(false);
  const [phase, setPhase] = useState('');
  const [result, setResult] = useState<PreflightResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [camPerm, requestCam] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [showCamera, setShowCamera] = useState(true);
  // Readiness checks that run as soon as the screen opens, so problems show up before the student agrees to anything.
  const [net, setNet] = useState<{ state: 'testing' | 'done' | 'error'; r?: NetworkResult }>({ state: 'testing' });
  const [micGranted, setMicGranted] = useState<boolean | null>(null);
  const [micCanAsk, setMicCanAsk] = useState(true);

  const probeNet = useCallback(async () => {
    setNet({ state: 'testing' });
    try {
      setNet({ state: 'done', r: await measureNetwork() });
    } catch {
      setNet({ state: 'error' });
    }
  }, []);
  useEffect(() => {
    void probeNet();
    if (needMic) {
      AudioModule.getRecordingPermissionsAsync().then((p) => { setMicGranted(p.granted); setMicCanAsk(p.canAskAgain); }).catch(() => setMicGranted(false));
    }
  }, [probeNet, needMic]);
  const netWeak = !!policy && !!net.r && (net.r.rttMs > policy.maxRttMs || net.r.downMbps < policy.minDownMbps);
  const camOk = !needCamera || !!camPerm?.granted;
  const micOk = !needMic || micGranted === true;
  const netOk = !features.connectionCheck || (net.state === 'done' && !netWeak);
  const ready = camOk && micOk && netOk;

  async function allowCamera() {
    if (camPerm && !camPerm.granted && !camPerm.canAskAgain) return void Linking.openSettings();
    await requestCam();
  }
  async function allowMic() {
    if (!micCanAsk) return void Linking.openSettings();
    const p = await AudioModule.requestRecordingPermissionsAsync();
    setMicGranted(p.granted);
    setMicCanAsk(p.canAskAgain);
  }
  const checks: { key: string; icon: keyof typeof Ionicons.glyphMap; title: string; state: 'ok' | 'wait' | 'bad' | 'info'; detail: string; action?: { label: string; onPress: () => void } }[] = [
    ...(features.connectionCheck
      ? [{
          key: 'net', icon: 'wifi' as const, title: tx('Internet connection', 'इंटरनेट कनेक्शन'),
          state: net.state === 'testing' ? 'wait' as const : net.state === 'error' || netWeak ? 'bad' as const : 'ok' as const,
          detail: net.state === 'testing' ? tx('Testing speed and delay…', 'स्पीड और देरी जाँची जा रही है…')
            : net.state === 'error' || !net.r ? tx('Could not reach the server. Check your internet.', 'सर्वर तक नहीं पहुँच सके। इंटरनेट जाँचें।')
              : `${Math.round(net.r.rttMs)} ms · ${net.r.downMbps.toFixed(1)} Mbps${netWeak ? ` — ${tx('too weak for this test', 'इस टेस्ट के लिए कमज़ोर')}` : ''}`,
          action: net.state === 'testing' ? undefined : { label: tx('Test again', 'फिर जाँचें'), onPress: () => void probeNet() },
        }]
      : []),
    ...(needCamera
      ? [{
          key: 'cam', icon: 'camera' as const, title: tx('Camera', 'कैमरा'),
          state: camPerm?.granted ? 'ok' as const : 'bad' as const,
          detail: camPerm?.granted ? tx('Allowed. Make sure your face is clearly visible below.', 'अनुमति मिली। नीचे अपना चेहरा साफ़ दिखाएँ।') : tx('Permission needed to take this test.', 'इस टेस्ट के लिए अनुमति ज़रूरी है।'),
          action: camPerm?.granted ? undefined : { label: camPerm && !camPerm.canAskAgain ? tx('Open settings', 'सेटिंग खोलें') : tx('Allow', 'अनुमति दें'), onPress: () => void allowCamera() },
        }]
      : []),
    ...(needMic
      ? [{
          key: 'mic', icon: 'mic' as const, title: tx('Microphone', 'माइक्रोफ़ोन'),
          state: micGranted ? 'ok' as const : micGranted === null ? 'wait' as const : 'bad' as const,
          detail: micGranted ? tx('Allowed.', 'अनुमति मिली।') : tx('Permission needed to take this test.', 'इस टेस्ट के लिए अनुमति ज़रूरी है।'),
          action: micGranted || micGranted === null ? undefined : { label: micCanAsk ? tx('Allow', 'अनुमति दें') : tx('Open settings', 'सेटिंग खोलें'), onPress: () => void allowMic() },
        }]
      : []),
    ...(needScreen
      ? [{ key: 'screen', icon: 'phone-portrait' as const, title: tx('Screen sharing', 'स्क्रीन शेयरिंग'), state: 'info' as const, detail: tx('Android will ask you to share your screen when you tap Start. Choose “Entire screen”.', 'Start दबाने पर Android स्क्रीन शेयर करने को कहेगा। “Entire screen” चुनें।') }]
      : []),
    { key: 'device', icon: 'shield-checkmark' as const, title: tx('Device security', 'डिवाइस सुरक्षा'), state: 'info' as const, detail: tx('Verified with Google/Apple when you tap Start.', 'Start दबाने पर Google/Apple से सत्यापित होगा।') },
  ];

  const purposes = [
    ...(features.connectionCheck ? [tx('Connection: we measure your internet speed and delay so the test does not break halfway.', 'कनेक्शन: हम आपकी इंटरनेट स्पीड और देरी मापते हैं ताकि टेस्ट बीच में न रुके।')] : []),
    tx('Device security: we verify with Google/Apple that this is an unmodified phone running the official app. This blocks rooted phones, emulators and remote-control tools.', 'डिवाइस सुरक्षा: हम Google/Apple से जाँचते हैं कि यह बिना बदलाव वाला फ़ोन है और आधिकारिक ऐप चल रहा है। इससे रूटेड फ़ोन, एमुलेटर और रिमोट-कंट्रोल टूल रुकते हैं।'),
    ...(needCamera ? [tx('Camera: to confirm that you are alone and to detect a phone, book or another person during the test.', 'कैमरा: यह पक्का करने के लिए कि आप अकेले हैं, और टेस्ट में फ़ोन, किताब या दूसरे व्यक्ति को पहचानने के लिए।')] : []),
    ...(needMic ? [tx('Microphone: to detect talking or answers being read out loud.', 'माइक्रोफ़ोन: बातचीत या उत्तर बोले जाने को पहचानने के लिए।')] : []),
    ...(needScreen ? [tx('Screen sharing: a proctor can see your screen during the test, to make sure no other app is used. Other people’s screens are never shown to you.', 'स्क्रीन शेयरिंग: टेस्ट के दौरान निगरानीकर्ता आपकी स्क्रीन देख सकता है, ताकि कोई दूसरा ऐप इस्तेमाल न हो।')] : []),
    ...(features.liveStream ? [tx('A proctor may watch and listen live. A red “LIVE” indicator stays visible while this happens.', 'निगरानीकर्ता लाइव देख और सुन सकता है। इस दौरान लाल “LIVE” संकेत दिखता रहेगा।')] : []),
  ];
  const flagNames = (policy?.instantDisqualifyFlags ?? []).map((f) => FLAG_TYPES[f as ProctorFlagType]?.[hi ? 'labelHi' : 'labelEn']).filter(Boolean).join(', ');
  const rules = [
    tx('Take the test alone, in a quiet place. Keep your face in view.', 'टेस्ट अकेले, शांत जगह पर दें। अपना चेहरा कैमरे में रखें।'),
    tx('No phones, books, notes, earphones, other devices or other apps.', 'कोई फ़ोन, किताब, नोट्स, ईयरफ़ोन, दूसरा डिवाइस या दूसरा ऐप नहीं।'),
    tx('Do not leave this app, share your screen elsewhere or use remote-control tools.', 'यह ऐप न छोड़ें, स्क्रीन कहीं और शेयर न करें, रिमोट-कंट्रोल टूल इस्तेमाल न करें।'),
    ...(features.autoSubmit && policy?.autoSubmitRules.length
      ? [tx(
          `You get a warning each time you ${policy.autoSubmitRules.some((r) => r.flag === 'APP_SWITCH') ? 'leave this app' : ''}${policy.autoSubmitRules.length > 1 ? ' or' : ''}${policy.autoSubmitRules.some((r) => r.flag === 'MULTIPLE_FACES') ? ' another person appears on camera' : ''}. After ${policy.autoSubmitRules.map((r) => r.count).join('/')} times your test is submitted automatically.`,
          'हर बार जब आप ऐप छोड़ते हैं या कैमरे पर दूसरा व्यक्ति दिखता है, आपको चेतावनी मिलेगी। तय बार के बाद आपका टेस्ट अपने आप जमा हो जाएगा।',
        )]
      : []),
    instant
      ? tx(`Cheating is detected as it happens. ${flagNames ? `${flagNames}: ` : ''}your test ends immediately and you are disqualified. A reviewer can reverse this on appeal.`, `नकल उसी समय पकड़ी जाती है। ${flagNames ? `${flagNames}: ` : ''}आपका टेस्ट तुरंत समाप्त होगा और आप अयोग्य घोषित होंगे। अपील पर समीक्षक इसे पलट सकता है।`)
      : tx('Anything else suspicious is flagged to a proctor straight away. A person reviews it before any action is taken; confirmed cheating leads to disqualification.', 'बाकी संदिग्ध गतिविधि तुरंत निगरानीकर्ता को दिखती है। कोई कार्रवाई होने से पहले एक व्यक्ति उसकी समीक्षा करता है; नकल की पुष्टि पर अयोग्यता होगी।'),
  ];

  async function run() {
    if (!policy || !user) return;
    setError(null);
    setStep('checking');
    let streaming = false;
    try {
      let permissions = { camera: false, microphone: false };
      let faceCheck: ProctorPreflightInput['faceCheck'] = null;
      if (needCamera || needMic) {
        setPhase(tx('Asking for permissions…', 'अनुमतियाँ माँगी जा रही हैं…'));
        const cam = needCamera ? (camPerm?.granted ? camPerm : await requestCam()) : { granted: false };
        const mic = needMic ? await AudioModule.requestRecordingPermissionsAsync() : { granted: false };
        permissions = { camera: cam.granted, microphone: mic.granted };
        if (needCamera && cam.granted && cameraReady && camera.current) {
          setPhase(tx('Checking your face…', 'आपका चेहरा जाँचा जा रहा है…'));
          const shot = await camera.current.takePictureAsync({ quality: 0.4, skipProcessing: true, shutterSound: false });
          const faces = shot?.uri ? await FaceDetection.detect(shot.uri, { performanceMode: 'fast' }) : [];
          faceCheck = { faces: faces.length, passed: faces.length === 1 };
        }
      }
      setPhase(tx('Testing your connection…', 'कनेक्शन जाँचा जा रहा है…'));
      const network = await measureNetwork();
      setPhase(tx('Verifying your device…', 'आपका डिवाइस सत्यापित हो रहा है…'));
      const [device, integrity, challenge] = await Promise.all([collectDevice(), collectIntegrity(), fetchChallenge()]);
      const attestation = await attest(user.id, challenge.challenge, policy);
      const body: ProctorPreflightInput = {
        attemptRef: kind === 'tournament' ? { tournamentSlug: ref } : { testId: ref },
        consentVersion: policy.consentVersion,
        consentGiven: true,
        consent: { camera: needCamera && permissions.camera, microphone: needMic && permissions.microphone, screen: needScreen, rulesAcknowledged: true, textVersion: TEXT_VERSION, purposes: [...purposes, ...rules].map((p) => p.slice(0, 200)).slice(0, 10) },
        network,
        device,
        integrity,
        faceCheck,
        attestation,
        challengeId: challenge.challengeId,
        permissions,
      };
      const r = await api<PreflightResultDto>('/v1/proctor/preflight', { method: 'POST', body });
      setResult(r);
      if (!r.ok) {
        if (r.blockers.some((b) => ['ATTESTATION_FAILED', 'APP_TAMPERED', 'DEVICE_NOT_CERTIFIED'].includes(b.code))) await forgetAttestedKey(user.id);
        setStep('blocked');
        return;
      }
      await confirmAttestedKey(user.id);

      if (r.live) {
        // The preview must release the camera before the stream can use it.
        setShowCamera(false);
        await new Promise((res) => setTimeout(res, 500));
        setPhase(needScreen ? tx('Starting camera, microphone and screen sharing…', 'कैमरा, माइक और स्क्रीन शेयरिंग शुरू हो रही है…') : tx('Starting camera and microphone…', 'कैमरा और माइक शुरू हो रहे हैं…'));
        const s = await connectLive(r.live.url, r.live.token, { camera: true, microphone: true, screen: needScreen });
        if (!s.ok) {
          setShowCamera(true);
          setError(
            s.failed === 'screen'
              ? tx('Screen sharing is required for this test. Allow it when asked, then try again.', 'इस टेस्ट के लिए स्क्रीन शेयरिंग ज़रूरी है। पूछे जाने पर अनुमति दें और फिर कोशिश करें।')
              : s.failed === 'connect'
                ? tx('Could not reach the proctoring service. Check your connection and try again.', 'निगरानी सेवा से जुड़ नहीं सके। कनेक्शन जाँचकर फिर कोशिश करें।')
                : tx('Camera and microphone are required for this test. Allow them and try again.', 'इस टेस्ट के लिए कैमरा और माइक ज़रूरी हैं। अनुमति देकर फिर कोशिश करें।'),
          );
          setStep('consent');
          return;
        }
        streaming = true;
      }

      setStep('starting');
      setPhase(tx('Starting your test…', 'आपका टेस्ट शुरू हो रहा है…'));
      const path = kind === 'tournament' ? `/v1/tournaments/${ref}/attempt` : `/v1/tests/${ref}/attempts`;
      const paper = await api<AttemptPaperDto>(path, { method: 'POST', body: { proctorToken: r.token } });
      router.replace({ pathname: '/exam/[attemptId]', params: { attemptId: paper.attemptId } });
    } catch (e) {
      if (streaming) await disconnectLive();
      setShowCamera(true);
      setError(e instanceof ApiError ? (e.status === 0 ? tx('You appear to be offline.', 'आप ऑफ़लाइन लग रहे हैं।') : e.message) : String(e));
      setStep('consent');
    }
  }

  const busy = step === 'checking' || step === 'starting';
  return (
    <Screen edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ionicons name="shield-checkmark" size={28} color={palette.amber} />
          <AppText weight="extrabold" size={22}>{tx('Before you start', 'शुरू करने से पहले')}</AppText>
        </View>
        <AppText size={14} muted>{tx('This test is proctored. You will be asked for permission once, here. Nothing is turned on before you agree.', 'यह टेस्ट निगरानी में है। आपसे अनुमति यहीं, एक बार माँगी जाएगी। सहमति से पहले कुछ भी चालू नहीं होता।')}</AppText>

        <Card style={{ gap: 12 }}>
          <AppText weight="bold" size={14}>{tx('System check', 'सिस्टम जाँच')}</AppText>
          {checks.map((c) => (
            <View key={c.key} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              {c.state === 'wait' ? <ActivityIndicator size="small" color={palette.amber} /> : (
                <Ionicons name={c.state === 'ok' ? 'checkmark-circle' : c.state === 'bad' ? 'close-circle' : 'information-circle'} size={22} color={c.state === 'ok' ? palette.green : c.state === 'bad' ? '#DC2626' : '#9CA3AF'} />
              )}
              <View style={{ flex: 1 }}>
                <AppText weight="semibold" size={13}>{c.title}</AppText>
                <AppText size={12} muted>{c.detail}</AppText>
              </View>
              {c.action && <AppText weight="bold" size={12} color={palette.blue} onPress={c.action.onPress}>{c.action.label}</AppText>}
            </View>
          ))}
        </Card>

        <Card style={{ gap: 10 }}>
          <AppText weight="bold" size={14}>{tx('What we ask for, and why', 'हम क्या माँगते हैं, और क्यों')}</AppText>
          {purposes.map((m) => (
            <View key={m} style={{ flexDirection: 'row', gap: 8 }}>
              <Ionicons name="checkmark-circle-outline" size={16} color={palette.green} style={{ marginTop: 2 }} />
              <AppText size={13} style={{ flex: 1 }}>{m}</AppText>
            </View>
          ))}
          <AppText size={12} muted>{tx('No audio is stored. Photos are kept only when something is flagged, for a limited time.', 'कोई ऑडियो सेव नहीं होता। फ़ोटो केवल फ़्लैग होने पर, सीमित समय के लिए रखी जाती हैं।')}</AppText>
        </Card>

        <Card style={{ gap: 10, borderColor: '#FCD34D', borderWidth: 1 }}>
          <AppText weight="bold" size={14}>{tx('Rules', 'नियम')}</AppText>
          {rules.map((m) => (
            <View key={m} style={{ flexDirection: 'row', gap: 8 }}>
              <Ionicons name="alert-circle-outline" size={16} color={palette.amber} style={{ marginTop: 2 }} />
              <AppText size={13} style={{ flex: 1 }}>{m}</AppText>
            </View>
          ))}
        </Card>

        {needCamera && camPerm?.granted && showCamera && !busy && (
          <View style={styles.preview}>
            <CameraView ref={camera} facing="front" style={StyleSheet.absoluteFill} onCameraReady={() => setCameraReady(true)} />
            <View style={styles.badge}><AppText weight="bold" size={10} color="#FFF">{tx('Keep only your face in view', 'केवल अपना चेहरा दिखाएँ')}</AppText></View>
          </View>
        )}

        <Pressable onPress={() => setAgreed((a) => !a)} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }} accessibilityRole="checkbox" accessibilityState={{ checked: agreed }}>
          <Ionicons name={agreed ? 'checkbox' : 'square-outline'} size={22} color={agreed ? palette.amber : '#9CA3AF'} />
          <AppText size={13} style={{ flex: 1 }}>{tx('I have read and accept these permissions and rules, and I will take this test honestly.', 'मैंने इन अनुमतियों और नियमों को पढ़ा और स्वीकार किया है, और मैं यह टेस्ट ईमानदारी से दूँगा/दूँगी।')}</AppText>
        </Pressable>

        {step === 'blocked' && result && (
          <Card style={{ gap: 10, borderColor: '#FCA5A5', borderWidth: 1 }}>
            <AppText weight="bold" size={14} color="#B91C1C">{tx('You cannot start yet', 'आप अभी शुरू नहीं कर सकते')}</AppText>
            {result.blockers.map((b) => (
              <View key={b.code} style={{ gap: 2 }}>
                <AppText size={13}>{hi ? b.messageHi : b.messageEn}</AppText>
                {b.packages?.map((p) => <AppText key={p.packageId} size={12} muted>• {p.name}</AppText>)}
              </View>
            ))}
          </Card>
        )}
        {result?.warnings.map((w) => <AppText key={w.code} size={12} color="#92400E">{hi ? w.messageHi : w.messageEn}</AppText>)}
        {error && <AppText size={13} color="#B91C1C">{error}</AppText>}
        {Platform.OS === 'web' && <AppText size={13} color="#B91C1C">{tx('Proctored tests need the Testwise mobile app.', 'निगरानी वाले टेस्ट के लिए Testwise मोबाइल ऐप चाहिए।')}</AppText>}
      </ScrollView>

      <View style={{ padding: 20, maxWidth: 640, width: '100%', alignSelf: 'center', gap: 10 }}>
        {busy ? (
          <View style={{ alignItems: 'center', gap: 8 }}><ActivityIndicator color={palette.amber} /><AppText size={13} muted>{phase}</AppText></View>
        ) : (
          <Button title={step === 'blocked' ? tx('Check again', 'फिर से जाँचें') : tx('Agree & start test', 'सहमत हूँ और टेस्ट शुरू करें')} onPress={() => { void run(); }} disabled={!policy || !agreed || !ready || Platform.OS === 'web'} />
        )}
        <AppText size={13} muted style={{ textAlign: 'center' }} onPress={() => router.back()}>{tx('Cancel', 'रद्द करें')}</AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: { height: 220, borderRadius: 16, overflow: 'hidden', backgroundColor: '#111' },
  badge: { position: 'absolute', left: 10, bottom: 10, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
});
