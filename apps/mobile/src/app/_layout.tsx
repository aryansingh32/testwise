import '../i18n';
import {
  NotoSansDevanagari_400Regular,
  NotoSansDevanagari_700Bold,
} from '@expo-google-fonts/noto-sans-devanagari';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Screen, StateView, arena } from '../components/ui';
import { ApiError } from '../lib/api';
import { SessionProvider, useSession } from '../lib/session';
import { startPushListeners } from '../lib/push';

void SplashScreen.preventAutoHideAsync();

function versionLess(a: string, b: string) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  }
  return false;
}

/** Handles notification taps (including the one that launched the app) once signed in. */
function PushBridge() {
  const { user } = useSession();
  useEffect(() => (user?.onboarded ? startPushListeners() : undefined), [user?.id, user?.onboarded]);
  return null;
}

/** Blocks the app for maintenance mode or a forced update, both controlled from admin. */
function Gate({ children }: { children: React.ReactNode }) {
  const { ready, config, configError, language, reloadConfig } = useSession();
  const { t } = useTranslation();

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  if (!config && configError) {
    return (
      <Screen theme={arena}>
        <StateView theme={arena} title={t('common.offline')} action={t('common.retry')} onAction={reloadConfig} />
      </Screen>
    );
  }

  const status = config?.['app.status'];
  if (status?.maintenance) {
    return (
      <Screen theme={arena}>
        <StateView
          theme={arena}
          icon="construct-outline"
          title={t('maintenance.title')}
          body={language === 'HI' ? status.maintenanceMessageHi : status.maintenanceMessageEn}
          action={t('common.retry')}
          onAction={reloadConfig}
        />
      </Screen>
    );
  }

  const appVersion = Constants.expoConfig?.version ?? '0.0.0';
  if (status && versionLess(appVersion, status.minAppVersion)) {
    return (
      <Screen theme={arena}>
        <StateView theme={arena} icon="arrow-up-circle-outline" title={t('update.title')} body={t('update.body')} />
      </Screen>
    );
  }

  return <>{children}</>;
}

/**
 * Expo Router renders this instead of a crash/blank screen when any screen throws while rendering.
 * Answers in an exam are persisted locally and saved to the server continuously, so nothing typed is lost.
 */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  if (__DEV__) console.error('Screen error', error);
  return (
    <Screen>
      <StateView
        icon="warning-outline"
        title="Something went wrong · कुछ गड़बड़ हो गई"
        body="Your saved answers are safe. Tap to reload this screen. · आपके सहेजे गए उत्तर सुरक्षित हैं।"
        action="Try again · दोबारा कोशिश करें"
        onAction={retry}
      />
    </Screen>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // Retry only failures a retry can fix (no connection, timeout, overload). A 403/404/400 is the answer, not a glitch.
          queries: { retry: (failures, error) => failures < 2 && error instanceof ApiError && error.transient, staleTime: 30_000 },
        },
      }),
  );
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    NotoSansDevanagari_400Regular,
    NotoSansDevanagari_700Bold,
  });

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <Gate>
            <StatusBar style="auto" />
            <PushBridge />
            <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
              <Stack.Screen name="index" options={{ animation: 'none' }} />
              <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
              <Stack.Screen name="onboarding" options={{ animation: 'fade', gestureEnabled: false }} />
              <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
              <Stack.Screen name="exam/check" options={{ gestureEnabled: false, animation: 'slide_from_bottom' }} />
              <Stack.Screen name="exam/[attemptId]" options={{ gestureEnabled: false, animation: 'fade' }} />
              <Stack.Screen name="duels/play" options={{ gestureEnabled: false, animation: 'fade' }} />
            </Stack>
          </Gate>
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

