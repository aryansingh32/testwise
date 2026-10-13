import { DEFAULT_BLOCKED_APPS, type DeviceInfo, type IntegrityReport } from '@testwise/shared';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { installId } from './identity';

type Native = typeof import('../../../modules/device-integrity').default;

/** The native module is missing in Expo Go and on web; those clients cannot take proctored tests (server: requireNativeApp). */
function native(): Native | null {
  if (Platform.OS === 'web') return null;
  try {
    return (require('../../../modules/device-integrity') as { default: Native }).default;
  } catch {
    return null;
  }
}

export const nativeIntegrity = native;

export async function collectDevice(): Promise<DeviceInfo> {
  return {
    brand: Device.brand,
    model: Device.modelName,
    osName: Device.osName,
    osVersion: Device.osVersion,
    appVersion: Constants.expoConfig?.version ?? null,
    deviceId: await installId(),
  };
}

/** Everything the device can tell us about itself. A claim, not proof: the server decides from the signed platform attestation. */
export async function collectIntegrity(extraBlocked: string[] = []): Promise<IntegrityReport> {
  const platform = Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : 'web';
  const mod = native();
  if (!mod) {
    return { platform, nativeChecks: false, remoteApps: [], accessibilityServices: [], rooted: false, emulator: !Device.isDevice, usbDebugging: false, developerMode: false, screenCaptured: false, externalDisplays: 0, headphones: false, multiWindow: false };
  }
  const names = new Map<string, { name: string; category: string }>(DEFAULT_BLOCKED_APPS.map((a) => [a.packageId, a]));
  const r = await mod.getReport([...names.keys(), ...extraBlocked]);
  return {
    platform,
    nativeChecks: true,
    remoteApps: r.remoteApps.map((packageId) => ({ packageId, name: names.get(packageId)?.name ?? packageId, category: names.get(packageId)?.category ?? 'OTHER' })),
    accessibilityServices: r.accessibilityServices,
    rooted: r.rooted,
    emulator: r.emulator || !Device.isDevice,
    usbDebugging: r.usbDebugging,
    developerMode: r.developerMode,
    screenCaptured: r.screenCaptured ?? false,
    externalDisplays: r.externalDisplays,
    headphones: r.headphones,
    multiWindow: r.multiWindow,
    hooked: r.hooked,
    sideloaded: r.sideloaded,
  };
}
