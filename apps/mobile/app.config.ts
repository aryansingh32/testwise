import { existsSync, readFileSync } from 'fs';
import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Firebase wiring (project `testwisee`):
 *  - google-services.json (Android) and GoogleService-Info.plist (iOS) come from the Firebase console / `firebase apps:sdkconfig`
 *    and are git-ignored. When present they enable FCM push, Google sign-in and phone OTP in native builds.
 *  - The Google *web* client id (client_type 3) is read from google-services.json for Google sign-in.
 *  - The iOS URL scheme for Google sign-in is read from the plist (REVERSED_CLIENT_ID, present once Google sign-in is enabled).
 */
function googleWebClientId(file: string): string | undefined {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8')) as { client?: { oauth_client?: { client_id: string; client_type: number }[] }[] };
    return j.client?.flatMap((c) => c.oauth_client ?? []).find((o) => o.client_type === 3)?.client_id;
  } catch {
    return undefined;
  }
}

function iosUrlScheme(file: string): string | undefined {
  try {
    return /<key>REVERSED_CLIENT_ID<\/key>\s*<string>([^<]+)<\/string>/.exec(readFileSync(file, 'utf8'))?.[1];
  } catch {
    return undefined;
  }
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const googleServices = process.env.GOOGLE_SERVICES_JSON ?? './google-services.json';
  const googlePlist = process.env.GOOGLE_SERVICE_INFO_PLIST ?? './GoogleService-Info.plist';
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? config.extra?.apiUrl;
  // A store build must never talk to a developer machine or plain HTTP.
  if (process.env.EAS_BUILD_PROFILE === 'production' && (!apiUrl || !/^https:\/\//.test(apiUrl) || /localhost|127\.0\.0\.1|10\.0\.2\.2|example\.com/.test(apiUrl))) {
    throw new Error(`Production build needs a real https EXPO_PUBLIC_API_URL (got "${apiUrl}"). Set it in eas.json → build.production.env.`);
  }
  const hasAndroid = existsSync(googleServices);
  const hasIos = existsSync(googlePlist);
  const scheme = hasIos ? iosUrlScheme(googlePlist) : undefined;
  return {
    ...(config as ExpoConfig),
    plugins: [
      // ALLOW_CLEARTEXT=1 is for internal test APKs that talk to an HTTP API on the local network. Never set for store builds.
      ...(config.plugins ?? []).map((p) =>
        process.env.ALLOW_CLEARTEXT === '1' && Array.isArray(p) && p[0] === 'expo-build-properties' ? ['expo-build-properties', { ...(p[1] as object), android: { usesCleartextTraffic: true } }] : p,
      ),
      // Native Google sign-in; the iOS URL scheme is only known once the Google provider is enabled in Firebase.
      ['@react-native-google-signin/google-signin', scheme ? { iosUrlScheme: scheme } : {}],
    ],
    ios: {
      ...config.ios,
      ...(hasIos && { googleServicesFile: googlePlist }),
    },
    android: {
      ...config.android,
      // HTTP is only for the dev client talking to a local API; store builds are HTTPS-only.
      ...(process.env.EAS_BUILD_PROFILE === 'production' && { allowBackup: false }),
      ...(hasAndroid && { googleServicesFile: googleServices }),
    },
    extra: {
      ...config.extra,
      apiUrl,
      googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? (hasAndroid ? googleWebClientId(googleServices) : undefined),
      firebaseProjectId: 'testwisee',
    },
  };
};
