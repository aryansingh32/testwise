import { z } from 'zod';

/**
 * Proctoring catalog shared by the API (rules, auto actions), the admin panel (labels,
 * filters) and the app (what to detect). Severity, points and auto-warn for each flag
 * are admin-controlled in `proctoring.policy.rules`; these are the defaults and labels.
 */

export type ProctorMode = 'OFF' | 'BASIC' | 'AI' | 'LIVE';
export type FlagSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type FlagStatus = 'OPEN' | 'CONFIRMED' | 'DISMISSED';

export const PROCTOR_MODE_INFO: Record<ProctorMode, { labelEn: string; labelHi: string; descriptionEn: string; descriptionHi: string }> = {
  OFF: { labelEn: 'Off', labelHi: 'बंद', descriptionEn: 'No monitoring beyond the server timer.', descriptionHi: 'सर्वर टाइमर के अलावा कोई निगरानी नहीं।' },
  BASIC: { labelEn: 'Simple proctoring', labelHi: 'सरल निगरानी', descriptionEn: 'Device security check, connection check, protected (black) screen, app-switch logging. No camera or microphone.', descriptionHi: 'डिवाइस सुरक्षा और कनेक्शन जाँच, सुरक्षित (काली) स्क्रीन, ऐप बदलने का लॉग। कैमरा या माइक नहीं।' },
  AI: { labelEn: 'AI proctoring', labelHi: 'AI निगरानी', descriptionEn: 'Simple proctoring plus on-device face, phone/object and speech detection. Flags appear in the admin panel at once with a photo.', descriptionHi: 'सरल निगरानी के साथ डिवाइस पर चेहरा, फ़ोन/वस्तु और आवाज़ की पहचान। फ़्लैग फ़ोटो के साथ तुरंत एडमिन पैनल में दिखते हैं।' },
  LIVE: { labelEn: 'Live proctoring', labelHi: 'लाइव निगरानी', descriptionEn: 'Camera, microphone and screen stream to proctors in the admin panel for the whole test (screen sharing on Android). On-device AI steps aside because the stream owns the camera.', descriptionHi: 'पूरे टेस्ट में कैमरा, माइक और स्क्रीन एडमिन पैनल में निगरानीकर्ताओं को स्ट्रीम होते हैं (स्क्रीन शेयरिंग Android पर)।' },
};

/**
 * Per-exam proctoring switches. The mode is a preset (BASIC = simple, AI = camera/speech/objects, LIVE = human proctor
 * with camera + mic + screen); `proctorOptions` on a test or tournament overrides single switches, and the global
 * Settings → Proctoring policy is the master switch that can only turn things off.
 */
export const PROCTOR_FEATURES = ['autoSubmit', 'connectionCheck', 'faceCheck', 'objectDetection', 'speech', 'liveStream', 'screenShare', 'instantDisqualify'] as const;
export type ProctorFeature = (typeof PROCTOR_FEATURES)[number];
export type ProctorFeatures = Record<ProctorFeature, boolean>;
export type ProctorOptions = Partial<ProctorFeatures>;

export const PROCTOR_FEATURE_INFO: Record<ProctorFeature, { label: string; hint: string }> = {
  autoSubmit: { label: 'Auto-submit after repeated violations', hint: 'Only for the rules in Settings → Proctoring (default: leaving the app 3 times, or more than one face 3 times). Everything else is flagged for an admin to decide.' },
  connectionCheck: { label: 'Connection check before start', hint: 'Measures delay and speed; blocks unstable connections.' },
  faceCheck: { label: 'Face checks (no face, second person, looking away)', hint: 'On-device, every couple of seconds, with a photo attached to the flag.' },
  objectDetection: { label: 'Phone / object detection', hint: 'Flags a phone, book or extra device in the camera view.' },
  speech: { label: 'Speech & spoken-answer detection', hint: 'Flags talking and spoken answer options; no audio is stored.' },
  liveStream: { label: 'Live camera + microphone to proctors', hint: 'Streams to the admin panel for the whole test. Replaces on-device face/object/speech checks (the camera and mic can only have one owner).' },
  screenShare: { label: 'Screen sharing to proctors (Android)', hint: 'The student shares their screen. The black-screen protection is lifted while sharing because the proctor is the intended viewer.' },
  instantDisqualify: { label: 'Instant disqualification on serious flags', hint: 'Ends the test at once and queues a disqualification for review. Which flags count is set in Settings → Proctoring.' },
};

const PRESETS: Record<Exclude<ProctorMode, 'OFF'>, ProctorOptions> = {
  BASIC: { autoSubmit: true, connectionCheck: true },
  AI: { autoSubmit: true, connectionCheck: true, faceCheck: true, objectDetection: true, speech: true },
  LIVE: { autoSubmit: true, connectionCheck: true, liveStream: true, screenShare: true },
};

/** Switches that apply to an attempt: mode preset, then exam overrides, then the global policy as a ceiling. */
export function resolveFeatures(
  mode: ProctorMode,
  options: ProctorOptions | null | undefined,
  policy: { speechDetection: boolean; objectDetection: boolean; requireScreenShare: boolean; liveEnabled: boolean; instantDisqualifyFlags: string[]; autoSubmitRules: unknown[] },
): ProctorFeatures {
  const off = Object.fromEntries(PROCTOR_FEATURES.map((f) => [f, false])) as ProctorFeatures;
  if (mode === 'OFF') return off;
  const f: ProctorFeatures = { ...off, ...PRESETS[mode], ...(options ?? {}) };
  if (!policy.objectDetection) f.objectDetection = false;
  if (!policy.speechDetection) f.speech = false;
  if (!policy.requireScreenShare) f.screenShare = false;
  if (!policy.liveEnabled) f.liveStream = false;
  if (!policy.instantDisqualifyFlags.length) f.instantDisqualify = false;
  if (!policy.autoSubmitRules.length) f.autoSubmit = false;
  if (f.screenShare && !f.liveStream) f.liveStream = policy.liveEnabled; // the share travels over the live room
  // The camera and microphone have one owner: when streaming to proctors, local detectors step aside.
  if (f.liveStream) { f.faceCheck = false; f.objectDetection = false; f.speech = false; }
  return f;
}

export const proctorOptionsSchema = z.object(Object.fromEntries(PROCTOR_FEATURES.map((k) => [k, z.boolean().optional()]))).strict().default({});

export const ProctorFlagType = {
  FACE_MISSING: 'FACE_MISSING',
  MULTIPLE_FACES: 'MULTIPLE_FACES',
  LOOKING_AWAY: 'LOOKING_AWAY',
  CAMERA_BLOCKED: 'CAMERA_BLOCKED',
  VOICE_DETECTED: 'VOICE_DETECTED',
  ANSWER_SPOKEN: 'ANSWER_SPOKEN',
  BACKGROUND_NOISE: 'BACKGROUND_NOISE',
  APP_SWITCH: 'APP_SWITCH',
  SPLIT_SCREEN: 'SPLIT_SCREEN',
  SCREENSHOT: 'SCREENSHOT',
  SCREEN_RECORDING: 'SCREEN_RECORDING',
  EXTERNAL_DISPLAY: 'EXTERNAL_DISPLAY',
  REMOTE_APP: 'REMOTE_APP',
  ACCESSIBILITY_SERVICE: 'ACCESSIBILITY_SERVICE',
  ROOTED_DEVICE: 'ROOTED_DEVICE',
  EMULATOR: 'EMULATOR',
  USB_DEBUGGING: 'USB_DEBUGGING',
  HEADPHONES: 'HEADPHONES',
  PERMISSION_REVOKED: 'PERMISSION_REVOKED',
  MULTIPLE_DEVICES: 'MULTIPLE_DEVICES',
  CONNECTION_LOST: 'CONNECTION_LOST',
  ATTESTATION_FAILED: 'ATTESTATION_FAILED',
  APP_TAMPERED: 'APP_TAMPERED',
  OVERLAY_DETECTED: 'OVERLAY_DETECTED',
  PHONE_DETECTED: 'PHONE_DETECTED',
  OBJECT_DETECTED: 'OBJECT_DETECTED',
  CAMERA_STOPPED: 'CAMERA_STOPPED',
  SCREEN_SHARE_STOPPED: 'SCREEN_SHARE_STOPPED',
  POOR_CONNECTION: 'POOR_CONNECTION',
  LOW_TRUST: 'LOW_TRUST',
  ANSWER_COLLUSION: 'ANSWER_COLLUSION',
  ANSWER_TIMING: 'ANSWER_TIMING',
  ANSWER_SPEED: 'ANSWER_SPEED',
  ADMIN_NOTE: 'ADMIN_NOTE',
} as const;
export type ProctorFlagType = (typeof ProctorFlagType)[keyof typeof ProctorFlagType];

export interface FlagTypeInfo {
  labelEn: string;
  labelHi: string;
  /** Shown to the student in warnings. */
  warnEn: string;
  warnHi: string;
  severity: FlagSeverity;
  points: number;
  autoWarn: boolean;
  /** Minimum proctoring mode in which the app reports this flag. */
  mode: Exclude<ProctorMode, 'OFF'>;
}

export const FLAG_TYPES: Record<ProctorFlagType, FlagTypeInfo> = {
  FACE_MISSING: { labelEn: 'Face not visible', labelHi: 'चेहरा नहीं दिख रहा', warnEn: 'Keep your face clearly visible to the camera.', warnHi: 'अपना चेहरा कैमरे में साफ़ दिखाई देने दें।', severity: 'MEDIUM', points: 10, autoWarn: true, mode: 'AI' },
  MULTIPLE_FACES: { labelEn: 'More than one person', labelHi: 'एक से अधिक व्यक्ति', warnEn: 'Another person was detected. You must take the test alone.', warnHi: 'दूसरा व्यक्ति दिखा। आपको टेस्ट अकेले देना होगा।', severity: 'CRITICAL', points: 40, autoWarn: true, mode: 'AI' },
  LOOKING_AWAY: { labelEn: 'Looking away from screen', labelHi: 'स्क्रीन से नज़र हटाई', warnEn: 'Keep your eyes on the screen.', warnHi: 'अपनी नज़र स्क्रीन पर रखें।', severity: 'LOW', points: 5, autoWarn: true, mode: 'AI' },
  CAMERA_BLOCKED: { labelEn: 'Camera covered or dark', labelHi: 'कैमरा ढका या अंधेरा', warnEn: 'Your camera seems covered or too dark.', warnHi: 'आपका कैमरा ढका हुआ या बहुत अंधेरा लग रहा है।', severity: 'HIGH', points: 20, autoWarn: true, mode: 'AI' },
  VOICE_DETECTED: { labelEn: 'Talking detected', labelHi: 'बातचीत सुनाई दी', warnEn: 'Talking was detected. Please stay silent during the test.', warnHi: 'बातचीत सुनाई दी। टेस्ट के दौरान चुप रहें।', severity: 'MEDIUM', points: 10, autoWarn: true, mode: 'AI' },
  ANSWER_SPOKEN: { labelEn: 'Answer spoken aloud', labelHi: 'उत्तर बोला गया', warnEn: 'Someone said an answer option aloud. This has been reported.', warnHi: 'किसी ने उत्तर विकल्प ज़ोर से बोला। इसकी रिपोर्ट की गई है।', severity: 'CRITICAL', points: 40, autoWarn: true, mode: 'AI' },
  BACKGROUND_NOISE: { labelEn: 'Loud background noise', labelHi: 'तेज़ पृष्ठभूमि शोर', warnEn: 'There is a lot of noise around you. Move to a quiet place.', warnHi: 'आपके आसपास बहुत शोर है। किसी शांत जगह जाएँ।', severity: 'LOW', points: 3, autoWarn: false, mode: 'AI' },
  APP_SWITCH: { labelEn: 'Left the test app', labelHi: 'टेस्ट ऐप छोड़ा', warnEn: 'You left the test. Leaving again may submit your test.', warnHi: 'आपने टेस्ट छोड़ा। दोबारा छोड़ने पर टेस्ट जमा हो सकता है।', severity: 'HIGH', points: 15, autoWarn: true, mode: 'BASIC' },
  SPLIT_SCREEN: { labelEn: 'Split screen / floating window', labelHi: 'स्प्लिट स्क्रीन / फ़्लोटिंग विंडो', warnEn: 'Close split screen or floating windows.', warnHi: 'स्प्लिट स्क्रीन या फ़्लोटिंग विंडो बंद करें।', severity: 'HIGH', points: 20, autoWarn: true, mode: 'BASIC' },
  SCREENSHOT: { labelEn: 'Screenshot taken', labelHi: 'स्क्रीनशॉट लिया', warnEn: 'Screenshots are not allowed during the test.', warnHi: 'टेस्ट के दौरान स्क्रीनशॉट की अनुमति नहीं है।', severity: 'HIGH', points: 20, autoWarn: true, mode: 'BASIC' },
  SCREEN_RECORDING: { labelEn: 'Screen being recorded or shared', labelHi: 'स्क्रीन रिकॉर्ड/शेयर हो रही है', warnEn: 'Stop screen recording or sharing now.', warnHi: 'स्क्रीन रिकॉर्डिंग या शेयरिंग तुरंत बंद करें।', severity: 'CRITICAL', points: 40, autoWarn: true, mode: 'BASIC' },
  EXTERNAL_DISPLAY: { labelEn: 'Screen mirrored to another display', labelHi: 'स्क्रीन दूसरे डिस्प्ले पर', warnEn: 'Disconnect screen casting or mirroring.', warnHi: 'स्क्रीन कास्टिंग या मिररिंग बंद करें।', severity: 'CRITICAL', points: 40, autoWarn: true, mode: 'BASIC' },
  REMOTE_APP: { labelEn: 'Remote-access risk reported', labelHi: 'रिमोट-एक्सेस जोखिम रिपोर्ट', warnEn: 'Close any remote-access or screen-sharing session. Installed apps cannot be scanned by this app.', warnHi: 'रिमोट-एक्सेस या स्क्रीन-शेयरिंग सत्र बंद करें। यह ऐप इंस्टॉल ऐप्स स्कैन नहीं कर सकता।', severity: 'CRITICAL', points: 40, autoWarn: true, mode: 'BASIC' },
  ACCESSIBILITY_SERVICE: { labelEn: 'Unknown accessibility service on', labelHi: 'अज्ञात एक्सेसिबिलिटी सेवा चालू', warnEn: 'An app can control your screen. Turn it off in Settings → Accessibility.', warnHi: 'कोई ऐप आपकी स्क्रीन नियंत्रित कर सकता है। सेटिंग्स → एक्सेसिबिलिटी में बंद करें।', severity: 'HIGH', points: 20, autoWarn: true, mode: 'BASIC' },
  ROOTED_DEVICE: { labelEn: 'Rooted / jailbroken device', labelHi: 'रूटेड / जेलब्रोकन डिवाइस', warnEn: 'Proctored tests cannot run on rooted or jailbroken phones.', warnHi: 'रूटेड या जेलब्रोकन फ़ोन पर निगरानी वाले टेस्ट नहीं चल सकते।', severity: 'CRITICAL', points: 40, autoWarn: false, mode: 'BASIC' },
  EMULATOR: { labelEn: 'Emulator', labelHi: 'एमुलेटर', warnEn: 'Proctored tests must be taken on a real phone.', warnHi: 'निगरानी वाले टेस्ट असली फ़ोन पर ही दें।', severity: 'CRITICAL', points: 40, autoWarn: false, mode: 'BASIC' },
  USB_DEBUGGING: { labelEn: 'USB debugging on', labelHi: 'USB डीबगिंग चालू', warnEn: 'Turn off USB debugging in Developer options.', warnHi: 'डेवलपर विकल्प में USB डीबगिंग बंद करें।', severity: 'MEDIUM', points: 10, autoWarn: true, mode: 'BASIC' },
  HEADPHONES: { labelEn: 'Headphones / earpiece connected', labelHi: 'हेडफ़ोन / ईयरपीस जुड़ा', warnEn: 'Disconnect headphones and earbuds.', warnHi: 'हेडफ़ोन और ईयरबड्स हटाएँ।', severity: 'MEDIUM', points: 10, autoWarn: true, mode: 'AI' },
  PERMISSION_REVOKED: { labelEn: 'Camera / mic permission removed', labelHi: 'कैमरा / माइक अनुमति हटाई', warnEn: 'Camera and microphone access are required for this test.', warnHi: 'इस टेस्ट के लिए कैमरा और माइक की अनुमति ज़रूरी है।', severity: 'HIGH', points: 25, autoWarn: true, mode: 'AI' },
  MULTIPLE_DEVICES: { labelEn: 'Same account on two devices', labelHi: 'एक खाता दो डिवाइस पर', warnEn: 'Your account is open on another device.', warnHi: 'आपका खाता दूसरे डिवाइस पर खुला है।', severity: 'CRITICAL', points: 40, autoWarn: true, mode: 'BASIC' },
  CONNECTION_LOST: { labelEn: 'Monitoring connection lost', labelHi: 'निगरानी कनेक्शन टूटा', warnEn: 'Your connection dropped. Stay online during the test.', warnHi: 'आपका कनेक्शन टूट गया। टेस्ट के दौरान ऑनलाइन रहें।', severity: 'LOW', points: 2, autoWarn: false, mode: 'BASIC' },
  ATTESTATION_FAILED: { labelEn: 'Device/app integrity check failed', labelHi: 'डिवाइस/ऐप इंटीग्रिटी जाँच विफल', warnEn: 'This device could not be verified as a genuine, unmodified phone running the official app.', warnHi: 'यह डिवाइस असली और बिना बदलाव वाले फ़ोन पर आधिकारिक ऐप के रूप में सत्यापित नहीं हो सका।', severity: 'CRITICAL', points: 40, autoWarn: false, mode: 'BASIC' },
  APP_TAMPERED: { labelEn: 'App modified or not from the store', labelHi: 'ऐप बदला हुआ या स्टोर से नहीं', warnEn: 'Install the official Testwise app from the Play Store / App Store.', warnHi: 'Play Store / App Store से आधिकारिक Testwise ऐप इंस्टॉल करें।', severity: 'CRITICAL', points: 40, autoWarn: false, mode: 'BASIC' },
  OVERLAY_DETECTED: { labelEn: 'Overlay / touch-obscuring window', labelHi: 'ओवरले / टच ढकने वाली विंडो', warnEn: 'Close apps that draw over the screen.', warnHi: 'स्क्रीन पर ऊपर दिखने वाले ऐप बंद करें।', severity: 'HIGH', points: 20, autoWarn: true, mode: 'BASIC' },
  PHONE_DETECTED: { labelEn: 'Phone visible in camera', labelHi: 'कैमरे में फ़ोन दिखा', warnEn: 'A phone or similar device was seen. Remove it from view now.', warnHi: 'फ़ोन या ऐसा डिवाइस दिखा। उसे तुरंत हटाएँ।', severity: 'CRITICAL', points: 40, autoWarn: true, mode: 'AI' },
  OBJECT_DETECTED: { labelEn: 'Book / notes / extra device visible', labelHi: 'किताब / नोट्स / अतिरिक्त डिवाइस दिखा', warnEn: 'Books, notes or extra devices are not allowed. Remove them.', warnHi: 'किताबें, नोट्स या अतिरिक्त डिवाइस की अनुमति नहीं है। उन्हें हटाएँ।', severity: 'HIGH', points: 20, autoWarn: true, mode: 'AI' },
  CAMERA_STOPPED: { labelEn: 'Camera stream stopped', labelHi: 'कैमरा स्ट्रीम बंद', warnEn: 'Your camera stopped. Turn it back on to continue.', warnHi: 'आपका कैमरा बंद हो गया। जारी रखने के लिए उसे चालू करें।', severity: 'HIGH', points: 25, autoWarn: true, mode: 'AI' },
  SCREEN_SHARE_STOPPED: { labelEn: 'Screen sharing stopped', labelHi: 'स्क्रीन शेयरिंग बंद', warnEn: 'Screen sharing stopped. Start it again immediately.', warnHi: 'स्क्रीन शेयरिंग बंद हो गई। उसे तुरंत फिर शुरू करें।', severity: 'CRITICAL', points: 40, autoWarn: true, mode: 'LIVE' },
  POOR_CONNECTION: { labelEn: 'Unstable connection', labelHi: 'अस्थिर कनेक्शन', warnEn: 'Your connection is weak. Move closer to your router or switch networks.', warnHi: 'आपका कनेक्शन कमज़ोर है। राउटर के पास जाएँ या नेटवर्क बदलें।', severity: 'LOW', points: 2, autoWarn: true, mode: 'BASIC' },
  LOW_TRUST: { labelEn: 'Low trust score — needs review', labelHi: 'कम भरोसा स्कोर — समीक्षा ज़रूरी', warnEn: '', warnHi: '', severity: 'HIGH', points: 0, autoWarn: false, mode: 'BASIC' },
  ANSWER_COLLUSION: { labelEn: 'Answer pattern matches another student', labelHi: 'उत्तर पैटर्न दूसरे छात्र से मेल खाता है', warnEn: '', warnHi: '', severity: 'HIGH', points: 30, autoWarn: false, mode: 'BASIC' },
  ANSWER_TIMING: { labelEn: 'Unnatural answer timing', labelHi: 'अस्वाभाविक उत्तर समय', warnEn: '', warnHi: '', severity: 'MEDIUM', points: 15, autoWarn: false, mode: 'BASIC' },
  ANSWER_SPEED: { labelEn: 'Answers faster than humanly plausible', labelHi: 'संभव गति से तेज़ उत्तर', warnEn: '', warnHi: '', severity: 'HIGH', points: 25, autoWarn: false, mode: 'BASIC' },
  ADMIN_NOTE: { labelEn: 'Proctor observation', labelHi: 'निरीक्षक टिप्पणी', warnEn: '', warnHi: '', severity: 'HIGH', points: 0, autoWarn: false, mode: 'BASIC' },
};

export const PROCTOR_FLAG_TYPES = Object.keys(FLAG_TYPES) as ProctorFlagType[];
export const SEVERITIES: FlagSeverity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

/**
 * Remote control, mirroring and recording apps checked before a proctored test (Android package
 * names). This is not an inventory of the phone: Android 11+ only lets the app see packages it
 * declares in the manifest <queries> (written at build time by the device-integrity config
 * plugin from this default list), so entries added later in admin take effect after the next
 * app build. iOS gives apps no way to check other installed apps; there the report is empty and
 * screen-capture/mirroring state is used instead. The app cannot uninstall anything itself: it
 * opens the system uninstall dialog and the student confirms.
 */
export const DEFAULT_BLOCKED_APPS = [
  { packageId: 'com.teamviewer.teamviewer.market.mobile', name: 'TeamViewer', category: 'REMOTE_CONTROL' },
  { packageId: 'com.teamviewer.quicksupport.market', name: 'TeamViewer QuickSupport', category: 'REMOTE_CONTROL' },
  { packageId: 'com.teamviewer.host.market', name: 'TeamViewer Host', category: 'REMOTE_CONTROL' },
  { packageId: 'com.anydesk.anydeskandroid', name: 'AnyDesk', category: 'REMOTE_CONTROL' },
  { packageId: 'com.carriez.flutter_hbb', name: 'RustDesk', category: 'REMOTE_CONTROL' },
  { packageId: 'com.google.chromeremotedesktop', name: 'Chrome Remote Desktop', category: 'REMOTE_CONTROL' },
  { packageId: 'com.microsoft.rdc.androidx', name: 'Microsoft Remote Desktop', category: 'REMOTE_CONTROL' },
  { packageId: 'com.realvnc.viewer.android', name: 'RealVNC Viewer', category: 'REMOTE_CONTROL' },
  { packageId: 'com.splashtop.remote.pad.v2', name: 'Splashtop', category: 'REMOTE_CONTROL' },
  { packageId: 'com.zoho.assist.agent', name: 'Zoho Assist', category: 'REMOTE_CONTROL' },
  { packageId: 'com.sand.airdroid', name: 'AirDroid', category: 'REMOTE_CONTROL' },
  { packageId: 'com.sand.airmirror', name: 'AirMirror', category: 'REMOTE_CONTROL' },
  { packageId: 'com.rsupport.mvagent', name: 'Mobizen Mirroring', category: 'SCREEN_MIRROR' },
  { packageId: 'info.dvkr.screenstream', name: 'ScreenStream', category: 'SCREEN_MIRROR' },
  { packageId: 'com.hecorat.screenrecorder.free', name: 'AZ Screen Recorder', category: 'SCREEN_RECORDER' },
  { packageId: 'com.kimcy929.screenrecorder', name: 'Screen Recorder (Kimcy)', category: 'SCREEN_RECORDER' },
];


/** Accessibility services that are legitimate assistive tech and never flagged. */
export const DEFAULT_ACCESSIBILITY_ALLOWLIST = [
  'com.google.android.marvin.talkback',
  'com.samsung.android.accessibility.talkback',
  'com.samsung.accessibility',
  'com.google.android.accessibility.soundamplifier',
  'com.google.android.apps.accessibility.voiceaccess',
];

/**
 * Speech patterns that mean someone is saying an answer. Matched against a normalised
 * transcript (lowercase, punctuation removed, single spaces, padded with spaces), so a
 * pattern uses spaces instead of \b (which does not work for Devanagari).
 */
export const DEFAULT_ANSWER_PATTERNS = [
  { pattern: ' (option|answer|ans|choice|ऑप्शन|आंसर|उत्तर|विकल्प|जवाब) (is |हैं? )?(a|b|c|d|1|2|3|4|one|two|three|four|ए|बी|सी|डी|एक|दो|तीन|चार) ', note: '"option B", "answer is 2", "उत्तर सी"' },
  { pattern: '^ ?(a|b|c|d|ए|बी|सी|डी|one|two|three|four|एक|दो|तीन|चार) ?$', note: 'A single answer letter or number on its own' },
  { pattern: ' (question|q|prashn|प्रश्न|सवाल|क्वेश्चन) ?(no |number |नंबर )?\\d+ (is |का |की )?(a|b|c|d|ए|बी|सी|डी|\\d) ', note: '"question 5 C", "प्रश्न 3 का बी"' },
  { pattern: ' (first|second|third|fourth|last|पहला|दूसरा|तीसरा|चौथा|आखिरी) (one|option|वाला|विकल्प|ऑप्शन) ', note: '"second option", "तीसरा वाला"' },
  { pattern: ' (a|b|c|d|ए|बी|सी|डी) (hai|है|wala|वाला|sahi|सही|correct) ', note: '"B hai", "सी सही"' },
];

export function normaliseTranscript(text: string) {
  return ` ${text
    .toLowerCase()
    .replace(/[.,!?;:"'()\[\]{}।|\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

/** Returns the first pattern that matches the transcript, or null. Invalid patterns are skipped. */
export function matchAnswerSpeech(text: string, patterns: { pattern: string }[]): string | null {
  const t = normaliseTranscript(text);
  if (t.trim().length === 0) return null;
  for (const p of patterns) {
    try {
      if (new RegExp(p.pattern, 'iu').test(t)) return p.pattern;
    } catch {
      // Admin typo in a pattern must not break detection for the others.
    }
  }
  return null;
}

/**
 * Trust score, 0–100, for admins only (never sent to students). Starts at 100 and loses the points of every flag that
 * has not been dismissed, so a reviewer dismissing a false alarm restores it. It is a review aid, not a verdict.
 */
export const trustScore = (riskPoints: number) => Math.max(0, Math.min(100, 100 - riskPoints));
export type TrustBand = 'OK' | 'REVIEW' | 'LOW';
export const trustBand = (trust: number, reviewBelow = 60): TrustBand => (trust < reviewBelow / 2 ? 'LOW' : trust < reviewBelow ? 'REVIEW' : 'OK');

/** Risk band for a session's accumulated points. */
export function riskBand(points: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  if (points >= 80) return 'CRITICAL';
  if (points >= 40) return 'HIGH';
  if (points >= 15) return 'MEDIUM';
  return 'LOW';
}

// ---------- Device integrity report (sent by the app before and during a test) ----------

export interface IntegrityReport {
  platform: 'android' | 'ios' | 'web';
  /** Native integrity module present (dev/production build). False in Expo Go and on web. */
  nativeChecks: boolean;
  remoteApps: { packageId: string; name: string; category: string }[];
  accessibilityServices: string[];
  rooted: boolean;
  emulator: boolean;
  usbDebugging: boolean;
  developerMode: boolean;
  screenCaptured: boolean;
  externalDisplays: number;
  headphones: boolean;
  multiWindow: boolean;
  /** Another window is drawn over the app or filtering of obscured touches is bypassed. */
  overlay?: boolean;
  /** Android: FLAG_SECURE is applied, so captures/casts/recordings are black. */
  secureSurface?: boolean;
  /** App signature/installer sanity as seen on device (claim only; server attestation decides). */
  sideloaded?: boolean;
  /** Hooking frameworks (Frida/Xposed/Magisk-hide) seen by the app. */
  hooked?: boolean;
}

export interface DeviceInfo {
  brand: string | null;
  model: string | null;
  osName: string | null;
  osVersion: string | null;
  appVersion: string | null;
  deviceId: string | null;
}

/**
 * Proof from the platform that the request comes from the genuine, unmodified app on a real,
 * certified device. Android: a Play Integrity token. iOS: an App Attest attestation (first use on
 * an install) or assertion (every later exam). Both are bound to a server nonce from
 * `POST /v1/proctor/attest/challenge`, so they cannot be replayed or pre-recorded.
 */
export type AttestationEvidence =
  | { platform: 'android'; token: string }
  | { platform: 'ios'; keyId: string; attestation?: string; assertion?: string };

// ---------- API contracts ----------


const integrityReportSchema = z.object({
  platform: z.enum(['android', 'ios', 'web']),
  nativeChecks: z.boolean(),
  remoteApps: z.array(z.object({ packageId: z.string().max(150), name: z.string().max(60), category: z.string().max(30) })).max(100),
  accessibilityServices: z.array(z.string().max(200)).max(50),
  rooted: z.boolean(),
  emulator: z.boolean(),
  usbDebugging: z.boolean(),
  developerMode: z.boolean(),
  screenCaptured: z.boolean(),
  externalDisplays: z.number().int().min(0).max(10),
  headphones: z.boolean(),
  multiWindow: z.boolean(),
  overlay: z.boolean().optional(),
  secureSurface: z.boolean().optional(),
  sideloaded: z.boolean().optional(),
  hooked: z.boolean().optional(),
});

const deviceInfoSchema = z.object({
  brand: z.string().max(60).nullable(),
  model: z.string().max(100).nullable(),
  osName: z.string().max(40).nullable(),
  osVersion: z.string().max(40).nullable(),
  appVersion: z.string().max(40).nullable(),
  deviceId: z.string().max(100).nullable(),
});

const attestationSchema = z.discriminatedUnion('platform', [
  z.object({ platform: z.literal('android'), token: z.string().min(20).max(20_000) }),
  z.object({ platform: z.literal('ios'), keyId: z.string().min(10).max(200), attestation: z.string().max(40_000).optional(), assertion: z.string().max(10_000).optional() }),
]);

export const attestChallengeSchema = z.object({ purpose: z.enum(['PREFLIGHT', 'RECHECK']).default('PREFLIGHT') });

export const proctorPreflightSchema = z.object({
  attemptRef: z.object({ tournamentSlug: z.string().max(120).optional(), testId: z.string().max(40).optional() }).refine((r) => !!r.tournamentSlug !== !!r.testId, 'Give a tournament or a test'),
  consentVersion: z.string().max(20),
  consentGiven: z.literal(true),
  device: deviceInfoSchema,
  integrity: integrityReportSchema,
  faceCheck: z.object({ faces: z.number().int().min(0).max(20), passed: z.boolean() }).optional().nullable(),
  /** What the student was shown and agreed to, kept with the session as the record of why each permission was requested. */
  consent: z.object({
    camera: z.boolean(),
    microphone: z.boolean(),
    screen: z.boolean(),
    rulesAcknowledged: z.literal(true),
    /** Hash of the exact consent text displayed (version it, so we can show what was agreed). */
    textVersion: z.string().max(40),
    purposes: z.array(z.string().max(200)).max(10),
  }),
  network: z.object({ rttMs: z.number().min(0).max(60_000), downMbps: z.number().min(0).max(10_000), upMbps: z.number().min(0).max(10_000).optional(), samples: z.number().int().min(1).max(50) }),
  attestation: attestationSchema.optional().nullable(),
  /** Nonce the attestation was bound to. */
  challengeId: z.string().max(80).optional().nullable(),
  permissions: z.object({ camera: z.boolean(), microphone: z.boolean() }),
});
export type ProctorPreflightInput = z.infer<typeof proctorPreflightSchema>;

export const proctorFlagSchema = z.object({
  type: z.enum(PROCTOR_FLAG_TYPES as [ProctorFlagType, ...ProctorFlagType[]]),
  confidence: z.number().min(0).max(1).optional().nullable(),
  message: z.string().max(300).optional().nullable(),
  /** Allow-listed facts only, e.g. faces, yaw, transcript, package. */
  details: z
    .object({
      faces: z.number().int().min(0).max(20).optional(),
      yaw: z.number().min(-180).max(180).optional(),
      pitch: z.number().min(-180).max(180).optional(),
      transcript: z.string().max(500).optional(),
      matchedPattern: z.string().max(400).optional(),
      level: z.number().min(-200).max(200).optional(),
      durationSec: z.number().min(0).max(36000).optional(),
      packages: z.array(z.string().max(150)).max(50).optional(),
      objects: z.array(z.object({ label: z.string().max(60), confidence: z.number().min(0).max(1) })).max(10).optional(),
      rttMs: z.number().min(0).max(60_000).optional(),
      downMbps: z.number().min(0).max(10_000).optional(),
      questionIndex: z.number().int().min(0).max(1000).optional(),
      reasons: z.array(z.string().max(80)).max(20).optional(),
      peerAttemptId: z.string().max(40).optional(),
      sharedWrong: z.number().int().min(0).max(1000).optional(),
    })
    .strict()
    .default({}),
  clientAt: z.string().datetime({ offset: true }).optional(),
});
export type ProctorFlagInput = z.infer<typeof proctorFlagSchema>;

export const proctorHeartbeatSchema = z.object({
  appState: z.enum(['active', 'background', 'inactive']),
  questionIndex: z.number().int().min(0).max(1000).nullable(),
  answered: z.number().int().min(0).max(1000),
  marked: z.number().int().min(0).max(1000),
  faces: z.number().int().min(0).max(20).nullable(),
  noiseLevel: z.number().min(-200).max(200).nullable(),
  integrity: integrityReportSchema.partial().optional(),
  deviceId: z.string().max(100).nullable().optional(),
});
export type ProctorHeartbeat = z.infer<typeof proctorHeartbeatSchema>;

export const proctorWarnSchema = z.object({ message: z.string().trim().min(3).max(300) });
export const proctorReasonSchema = z.object({ reason: z.string().trim().min(3).max(300) });
export const flagReviewSchema = z.object({ status: z.enum(['CONFIRMED', 'DISMISSED']), note: z.string().trim().max(500).optional().nullable() });
export const adminFlagSchema = z.object({ type: z.enum(PROCTOR_FLAG_TYPES as [ProctorFlagType, ...ProctorFlagType[]]).default('ADMIN_NOTE'), message: z.string().trim().min(3).max(300), severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('HIGH') });

export interface PreflightResultDto {
  ok: boolean;
  /** Short-lived token the start endpoint requires for AI/LIVE modes. */
  token: string | null;
  mode: ProctorMode;
  /** LIVE mode: publish-only token for the room the consent screen streams into before the attempt starts. */
  live: { url: string; token: string } | null;
  /** Switches in force for this exam; the app uses these instead of guessing from the mode. */
  features: ProctorFeatures | null;
  blockers: { code: string; messageEn: string; messageHi: string; packages?: { packageId: string; name: string }[] }[];
  warnings: { code: string; messageEn: string; messageHi: string }[];
}

export interface EvidenceDto {
  kind: 'image' | 'audio';
  url: string;
  mime: string;
}

export interface ProctorFlagDto {
  id: string;
  sessionId: string;
  attemptId: string;
  type: ProctorFlagType;
  severity: FlagSeverity;
  source: 'DEVICE' | 'SERVER' | 'ADMIN';
  confidence: number | null;
  message: string;
  details: Record<string, unknown>;
  evidence: EvidenceDto[];
  status: FlagStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  occurredAt: string;
  /** Title of the test being taken, so an alert says which exam it is about. */
  testTitle?: string | null;
  user?: { id: string; displayName: string; email: string | null };
  tournament?: { id: string; titleEn: string } | null;
}

export interface ProctorActionDto {
  id: string;
  type: string;
  actor: 'SYSTEM' | 'ADMIN';
  adminName: string | null;
  message: string | null;
  createdAt: string;
}

export interface ProctorSessionDto {
  id: string;
  attemptId: string;
  mode: ProctorMode;
  status: 'ACTIVE' | 'ENDED' | 'TERMINATED';
  user: { id: string; displayName: string; email: string | null; status: string };
  tournament: { id: string; titleEn: string; slug: string } | null;
  device: DeviceInfo | null;
  integrity: Partial<IntegrityReport> | null;
  /** Last Play Integrity / App Attest result (summary only). */
  consent: { camera: boolean; microphone: boolean; screen: boolean; textVersion: string; purposes: string[]; at: string } | null;
  network: { rttMs: number; downMbps: number } | null;
  features: ProctorFeatures | null;
  attestation: { ok: boolean; level: 'STRONG' | 'DEVICE' | 'BASIC' | 'NONE'; reasons: string[]; riskyApps: string[]; platform: 'android' | 'ios' } | null;
  attestedAt: string | null;
  riskScore: number;
  /** Admin-only. 100 = fully trusted. */
  trust: number;
  trustBand: TrustBand;
  /** How many times the student left the app (not dismissed). */
  leftAppCount: number;
  risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  warningCount: number;
  flagCount: number;
  openFlags: number;
  online: boolean;
  appState: string | null;
  questionIndex: number | null;
  answered: number;
  totalQuestions: number;
  faces: number | null;
  snapshotUrl: string | null;
  snapshotAt: string | null;
  lastSeenAt: string | null;
  live: boolean;
  startedAt: string;
  deadlineAt: string;
}

export interface ProctorSessionDetailDto extends ProctorSessionDto {
  flags: ProctorFlagDto[];
  actions: ProctorActionDto[];
  snapshots: { url: string; faces: number | null; takenAt: string }[];
  consentAt: string;
  consentVersion: string;
}
