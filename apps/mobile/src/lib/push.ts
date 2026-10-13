import { CATEGORY_INFO, type NotificationCategory } from '@testwise/shared';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';
import { openLink } from './links';
import { storage } from './storage';

const TOKEN_KEY = 'tw_push_token';
const ASKED_KEY = 'tw_push_asked';
export const pushSupported = Platform.OS === 'android' || Platform.OS === 'ios';

// Show notifications while the app is open, too.
if (pushSupported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

/** One Android channel per category so students can tune them in phone settings too. */
async function ensureChannels() {
  if (Platform.OS !== 'android') return;
  for (const c of Object.keys(CATEGORY_INFO) as NotificationCategory[]) {
    await Notifications.setNotificationChannelAsync(c.toLowerCase(), {
      name: CATEGORY_INFO[c].labelEn,
      description: CATEGORY_INFO[c].descriptionEn,
      importance: c === 'PROMOTIONS' ? Notifications.AndroidImportance.DEFAULT : Notifications.AndroidImportance.HIGH,
      lightColor: '#F59E0B',
    });
  }
  await Notifications.setNotificationChannelAsync('reminders', { name: 'Test reminders', importance: Notifications.AndroidImportance.HIGH });
}

export async function permissionStatus(): Promise<'granted' | 'denied' | 'undetermined' | 'unsupported'> {
  if (!pushSupported || !Device.isDevice) return 'unsupported';
  const p = await Notifications.getPermissionsAsync();
  return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
}

export async function wasAsked() {
  return (await storage.get(ASKED_KEY)) === '1';
}

async function sendToken(data: string, type: string) {
  const provider = type === 'ios' ? 'APNS' : 'FCM';
  await api('/v1/me/devices', {
    method: 'POST',
    body: { token: data, provider, platform: type === 'ios' ? 'ios' : 'android', appVersion: Constants.expoConfig?.version ?? null, locale: Intl.DateTimeFormat().resolvedOptions().locale },
  });
  await storage.set(TOKEN_KEY, data);
}

/**
 * Ask for permission (if needed) and register this phone's native push token
 * (FCM on Android, APNs on iOS). Safe to call repeatedly.
 */
export async function registerForPush(askIfNeeded: boolean): Promise<boolean> {
  if (!pushSupported || !Device.isDevice) return false;
  await ensureChannels();
  let perm = await Notifications.getPermissionsAsync();
  if (!perm.granted && askIfNeeded && perm.canAskAgain) {
    await storage.set(ASKED_KEY, '1');
    perm = await Notifications.requestPermissionsAsync();
  }
  if (!perm.granted) return false;
  try {
    const token = await Notifications.getDevicePushTokenAsync();
    await sendToken(String(token.data), token.type);
    return true;
  } catch (e) {
    // Android needs google-services.json in the build for an FCM token.
    console.warn('Push registration failed', e);
    return false;
  }
}

export async function unregisterPush() {
  const token = await storage.get(TOKEN_KEY);
  if (!token) return;
  await api('/v1/me/devices/unregister', { method: 'POST', body: { token } }).catch(() => undefined);
  await storage.remove(TOKEN_KEY);
}

function handleResponse(response: Notifications.NotificationResponse | null) {
  if (!response) return;
  const data = response.notification.request.content.data as { batchId?: string; link?: string } | undefined;
  if (data?.batchId) void api('/v1/me/notifications/opened', { method: 'POST', body: { batchId: data.batchId } }).catch(() => undefined);
  if (data?.link) setTimeout(() => openLink(data.link), 300);
}

/** Listen for taps and token rotation. Returns a cleanup function. */
export function startPushListeners() {
  if (!pushSupported) return () => undefined;
  void Notifications.getLastNotificationResponseAsync().then((r) => {
    handleResponse(r);
    void Notifications.clearLastNotificationResponseAsync?.();
  });
  const tap = Notifications.addNotificationResponseReceivedListener(handleResponse);
  const rotate = Notifications.addPushTokenListener((t) => void sendToken(String(t.data), t.type).catch(() => undefined));
  return () => {
    tap.remove();
    rotate.remove();
  };
}

/** Local reminder on this phone (e.g. "5 minutes left" while a test is open in the background). */
export async function scheduleLocal(title: string, body: string, at: Date, link?: string) {
  if (!pushSupported || at.getTime() <= Date.now()) return null;
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) return null;
  return Notifications.scheduleNotificationAsync({
    content: { title, body, data: { link } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: 'reminders' },
  });
}

export async function cancelLocal(id: string | null) {
  if (id && pushSupported) await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
}
