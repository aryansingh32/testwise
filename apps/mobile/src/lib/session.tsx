import type { AuthResponse, LoginInput, MeDto, OnboardingInput, PublicAppConfig, RegisterInput } from '@testwise/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { currentLanguage, setAppLanguage, type AppLanguage } from '../i18n';
import { api, clearSession, loadTokens, saveSession, setSignedOutHandler } from './api';
import { firebaseSignOut } from './firebaseAuth';
import { registerForPush, unregisterPush } from './push';

interface SessionValue {
  ready: boolean;
  user: MeDto | null;
  config: PublicAppConfig | null;
  configError: boolean;
  language: AppLanguage;
  login(input: LoginInput): Promise<void>;
  /** Google / phone sign-in: exchange a Firebase ID token for our session. */
  loginWithFirebase(idToken: string): Promise<void>;
  register(input: RegisterInput): Promise<void>;
  logout(): Promise<void>;
  onboard(input: OnboardingInput): Promise<void>;
  setLanguage(lang: AppLanguage): Promise<void>;
  reloadConfig(): Promise<void>;
  refreshUser(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<MeDto | null>(null);
  const [config, setConfig] = useState<PublicAppConfig | null>(null);
  const [configError, setConfigError] = useState(false);
  const [language, setLang] = useState<AppLanguage>(currentLanguage());

  const applyUser = useCallback((u: MeDto | null) => {
    setUser(u);
    if (u) {
      setAppLanguage(u.language);
      setLang(u.language);
      // Re-register the push token each session (no prompt here; Home asks once with an explanation).
      if (u.onboarded) void registerForPush(false);
    }
  }, []);

  const reloadConfig = useCallback(async () => {
    try {
      setConfig(await api<PublicAppConfig>('/v1/app/config', { auth: false }));
      setConfigError(false);
    } catch {
      setConfigError(true);
    }
  }, []);

  useEffect(() => {
    setSignedOutHandler(() => {
      setUser(null);
      qc.clear();
    });
    void (async () => {
      await reloadConfig();
      if (await loadTokens()) {
        try {
          applyUser(await api<MeDto>('/v1/me'));
        } catch {
          /* expired or offline: show sign-in */
        }
      }
      setReady(true);
    })();
  }, [applyUser, qc, reloadConfig]);

  const onAuth = useCallback(
    async (r: AuthResponse) => {
      await saveSession(r);
      // Keep the language picked before sign-up if the account has never chosen one.
      applyUser(r.user);
    },
    [applyUser],
  );

  const value = useMemo<SessionValue>(
    () => ({
      ready,
      user,
      config,
      configError,
      language,
      reloadConfig,
      async refreshUser() {
        applyUser(await api<MeDto>('/v1/me'));
      },
      async login(input) {
        await onAuth(await api<AuthResponse>('/v1/auth/login', { method: 'POST', body: input, auth: false }));
      },
      async loginWithFirebase(idToken) {
        const r = await api<AuthResponse>('/v1/auth/firebase', { method: 'POST', body: { idToken }, auth: false });
        await saveSession(r);
        applyUser(r.user);
      },
      async register(input) {
        const r = await api<AuthResponse>('/v1/auth/register', { method: 'POST', body: input, auth: false });
        await saveSession(r);
        // New accounts adopt the language chosen on the intro screens.
        const u = language !== r.user.language ? await api<MeDto>('/v1/me/preferences', { method: 'PATCH', body: { language } }) : r.user;
        applyUser(u);
      },
      async logout() {
        await unregisterPush();
        await firebaseSignOut();
        await clearSession();
        setUser(null);
        qc.clear();
      },
      async onboard(input) {
        applyUser(await api<MeDto>('/v1/me/onboarding', { method: 'PATCH', body: input }));
        void qc.invalidateQueries();
      },
      async setLanguage(lang) {
        setAppLanguage(lang);
        setLang(lang);
        if (user) applyUser(await api<MeDto>('/v1/me/preferences', { method: 'PATCH', body: { language: lang } }));
      },
    }),
    [ready, user, config, configError, language, reloadConfig, onAuth, applyUser, qc],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession outside SessionProvider');
  return ctx;
}
