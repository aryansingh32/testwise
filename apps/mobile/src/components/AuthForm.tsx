import { Ionicons } from '@expo/vector-icons';
import { loginSchema, registerSchema } from '@testwise/shared';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { ApiError } from '../lib/api';
import { FirebaseUnavailable, googleIdToken } from '../lib/firebaseAuth';
import { useSession } from '../lib/session';
import { palette } from '../theme/tokens';
import { AppText, Button, Input, Screen } from './ui';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const { t } = useTranslation();
  const { login, register, loginWithFirebase, config } = useSession();
  const methods = config?.['auth.methods'] ?? { emailPassword: true, google: false, phoneOtp: false };
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<TextInput>(null);
  const passRef = useRef<TextInput>(null);
  const isLogin = mode === 'login';

  async function submit() {
    setFormError(null);
    const input = isLogin ? { email, password } : { email, password, displayName: name };
    const parsed = (isLogin ? loginSchema : registerSchema).safeParse(input);
    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const i of parsed.error.issues) e[String(i.path[0])] ??= i.message;
      setErrors(e);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      if (isLogin) await login(parsed.data as { email: string; password: string });
      else await register(parsed.data as { email: string; password: string; displayName: string });
      // Layout redirects once the session has a user.
    } catch (e) {
      setFormError(e instanceof ApiError && e.status === 0 ? t('common.offline') : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setFormError(null);
    setBusy(true);
    try {
      await loginWithFirebase(await googleIdToken());
    } catch (e) {
      if (e instanceof FirebaseUnavailable) Alert.alert(t('common.comingSoon'), e.message);
      else if ((e as Error).message !== 'Google sign-in was cancelled') setFormError(e instanceof ApiError && e.status === 0 ? t('common.offline') : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/intro'))} style={styles.back} hitSlop={10} accessibilityLabel={t('common.back')}>
            <Ionicons name="chevron-back" size={22} color={palette.ink} />
          </Pressable>

          <View style={styles.logo}>
            <Ionicons name="trophy" size={22} color="#FFFFFF" />
          </View>
          <AppText weight="extrabold" size={28} style={{ marginTop: 20 }}>
            {isLogin ? t('auth.loginTitle') : t('auth.registerTitle')}
          </AppText>
          <AppText muted size={14} style={{ marginTop: 4, marginBottom: 28 }}>
            {isLogin ? t('auth.loginSubtitle') : t('auth.registerSubtitle')}
          </AppText>

          {methods.emailPassword && (
            <View style={{ gap: 16 }}>
              {!isLogin && (
                <Input label={t('auth.name')} icon="person-outline" value={name} onChangeText={setName} autoComplete="name" textContentType="name" returnKeyType="next" onSubmitEditing={() => emailRef.current?.focus()} error={errors.displayName} />
              )}
              <Input ref={emailRef} label={t('auth.email')} icon="mail-outline" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" returnKeyType="next" onSubmitEditing={() => passRef.current?.focus()} error={errors.email} />
              <Input ref={passRef} label={t('auth.password')} icon="lock-closed-outline" value={password} onChangeText={setPassword} secureTextEntry autoComplete={isLogin ? 'current-password' : 'new-password'} textContentType={isLogin ? 'password' : 'newPassword'} returnKeyType="go" onSubmitEditing={submit} hint={isLogin ? undefined : t('auth.passwordHint')} error={errors.password} />
              {isLogin && (
                <Pressable onPress={() => Alert.alert(t('auth.forgot'), t('auth.forgotSoon'))} style={{ alignSelf: 'flex-end' }}>
                  <AppText weight="bold" size={13} color={palette.amber}>{t('auth.forgot')}</AppText>
                </Pressable>
              )}
              {formError && (
                <View style={styles.formError}>
                  <Ionicons name="alert-circle" size={16} color={palette.red} />
                  <AppText size={13} color={palette.red} style={{ flex: 1 }}>{formError}</AppText>
                </View>
              )}
              <Button title={isLogin ? t('auth.signIn') : t('auth.signUp')} onPress={submit} loading={busy} style={{ marginTop: 4 }} />
            </View>
          )}

          {(methods.google || methods.phoneOtp) && (
            <>
              <View style={styles.divider}>
                <View style={styles.line} />
                <AppText size={12} muted>{t('auth.or')}</AppText>
                <View style={styles.line} />
              </View>
              <View style={{ gap: 12 }}>
                {methods.google && <Button title={t('auth.google')} variant="secondary" icon="logo-google" onPress={google} loading={busy} />}
                {methods.phoneOtp && <Button title={t('auth.phone')} variant="secondary" icon="call-outline" onPress={() => router.push('/phone')} />}
              </View>
            </>
          )}

          <View style={styles.switch}>
            <AppText size={14} muted>{isLogin ? t('auth.noAccount') : t('auth.haveAccount')}</AppText>
            <Pressable onPress={() => router.replace(isLogin ? '/register' : '/login')} hitSlop={8}>
              <AppText weight="bold" size={14} color={palette.amber}>{isLogin ? t('auth.createOne') : t('auth.signInLink')}</AppText>
            </Pressable>
          </View>
          <AppText size={11} color="#9CA3AF" style={{ textAlign: 'center', marginTop: 16 }}>{t('auth.terms')}</AppText>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, paddingTop: 8, flexGrow: 1, maxWidth: 480, width: '100%', alignSelf: 'center' },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F6F7F9', alignItems: 'center', justifyContent: 'center' },
  logo: { width: 48, height: 48, borderRadius: 14, backgroundColor: palette.amber, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  formError: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: '#FEF2F2', padding: 12, borderRadius: 12 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 24 },
  line: { flex: 1, height: 1, backgroundColor: '#EEF0F3' },
  switch: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 'auto', paddingTop: 28 },
});
