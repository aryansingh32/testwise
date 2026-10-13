import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Header } from '../components/Header';
import { AppText, Button, Card, Input, Screen } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { palette } from '../theme/tokens';

export default function Settings() {
  const { t } = useTranslation();
  const { user, language, setLanguage, refreshUser } = useSession();
  const [name, setName] = useState(user?.displayName ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api('/v1/me/preferences', { method: 'PATCH', body: { displayName: name.trim() } });
      await refreshUser();
      setMsg(t('settings.saved'));
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Header title={t('settings.title')} fallback="/profile" />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        <Card style={{ gap: 12 }}>
          <Input label={t('settings.name')} value={name} onChangeText={setName} icon="person-outline" />
          {msg && <AppText size={13} color={msg === t('settings.saved') ? palette.green : palette.red}>{msg}</AppText>}
          <Button title={t('common.save')} onPress={save} loading={busy} disabled={name.trim().length < 2 || name.trim() === user?.displayName} size="md" />
        </Card>
        <Card style={{ gap: 12 }}>
          <AppText weight="semibold" size={12} muted>{t('profile.language')}</AppText>
          <View style={styles.langs}>
            {(['EN', 'HI'] as const).map((l) => (
              <Pressable key={l} onPress={() => setLanguage(l)} style={[styles.lang, language === l && styles.langOn]} accessibilityRole="radio" accessibilityState={{ selected: language === l }}>
                <AppText weight="bold" size={15} color={language === l ? palette.amber : palette.ink}>{l === 'EN' ? 'English' : 'हिन्दी'}</AppText>
              </Pressable>
            ))}
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  langs: { flexDirection: 'row', gap: 12 },
  lang: { flex: 1, alignItems: 'center', padding: 14, borderRadius: 14, borderWidth: 2, borderColor: '#EEF0F3' },
  langOn: { borderColor: palette.amber, backgroundColor: '#FFFBEB' },
});
