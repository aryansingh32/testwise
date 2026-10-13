import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText, Button, Input, Screen } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { confirmPhoneCode, FirebaseUnavailable, sendPhoneCode } from '../../lib/firebaseAuth';
import { useSession } from '../../lib/session';
import { palette } from '../../theme/tokens';

/** Sign in with a phone number: Firebase sends the code, we only receive the verified Firebase token. */
export default function PhoneSignIn() {
  const { t } = useTranslation();
  const { loginWithFirebase } = useSession();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirmation = useRef<Awaited<ReturnType<typeof sendPhoneCode>> | null>(null);
  const [sent, setSent] = useState(false);

  const e164 = () => {
    const digits = phone.replace(/[^\d+]/g, '');
    return digits.startsWith('+') ? digits : `+91${digits.replace(/^0+/, '')}`;
  };

  async function send() {
    setError(null);
    if (!/^\+\d{10,15}$/.test(e164())) return setError(t('auth.phoneInvalid'));
    setBusy(true);
    try {
      confirmation.current = await sendPhoneCode(e164());
      setSent(true);
    } catch (e) {
      if (e instanceof FirebaseUnavailable) Alert.alert(t('common.comingSoon'), e.message);
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!confirmation.current) return;
    setError(null);
    setBusy(true);
    try {
      await loginWithFirebase(await confirmPhoneCode(confirmation.current, code.trim()));
      // The layout redirects once the session has a user.
    } catch (e) {
      setError(e instanceof ApiError && e.status === 0 ? t('common.offline') : t('auth.codeWrong'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10} accessibilityLabel={t('common.back')}><Ionicons name="chevron-back" size={22} color={palette.ink} /></Pressable>
          <AppText weight="extrabold" size={28} style={{ marginTop: 24 }}>{t('auth.phoneTitle')}</AppText>
          <AppText muted size={14} style={{ marginTop: 4, marginBottom: 24 }}>{sent ? t('auth.phoneSent', { phone: e164() }) : t('auth.phoneSubtitle')}</AppText>
          {!sent ? (
            <View style={{ gap: 16 }}>
              <Input label={t('auth.phone')} icon="call-outline" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" hint="+91 …" />
              {error && <AppText size={13} color={palette.red}>{error}</AppText>}
              <Button title={t('auth.sendCode')} onPress={send} loading={busy} disabled={phone.replace(/\D/g, '').length < 10} />
            </View>
          ) : (
            <View style={{ gap: 16 }}>
              <Input label={t('auth.code')} icon="keypad-outline" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} autoComplete="sms-otp" textContentType="oneTimeCode" />
              {error && <AppText size={13} color={palette.red}>{error}</AppText>}
              <Button title={t('auth.verify')} onPress={verify} loading={busy} disabled={code.trim().length < 6} />
              <Pressable onPress={() => { setSent(false); setCode(''); setError(null); }}><AppText weight="bold" size={13} color={palette.amber}>{t('auth.changeNumber')}</AppText></Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, paddingTop: 8, flexGrow: 1, maxWidth: 480, width: '100%', alignSelf: 'center' },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F6F7F9', alignItems: 'center', justifyContent: 'center' },
});
