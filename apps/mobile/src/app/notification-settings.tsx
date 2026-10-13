import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Header } from '../components/Header';
import { AppText, Button, Card, ErrorState, Loading, Screen } from '../components/ui';
import { api } from '../lib/api';
import { permissionStatus, pushSupported, registerForPush } from '../lib/push';
import { useSession } from '../lib/session';
import { palette } from '../theme/tokens';

interface Pref { category: string; labelEn: string; labelHi: string; descriptionEn: string; descriptionHi: string; mutable: boolean; push: boolean }

export default function NotificationSettings() {
  const { t } = useTranslation();
  const { language } = useSession();
  const qc = useQueryClient();
  const [system, setSystem] = useState<string>('granted');
  const { data, error, isLoading, refetch } = useQuery({ queryKey: ['notification-settings'], queryFn: () => api<Pref[]>('/v1/me/notification-settings') });

  useEffect(() => {
    void permissionStatus().then(setSystem);
  }, []);

  async function toggle(p: Pref, value: boolean) {
    qc.setQueryData<Pref[]>(['notification-settings'], (old) => old?.map((x) => (x.category === p.category ? { ...x, push: value } : x)));
    await api('/v1/me/notification-settings', { method: 'PUT', body: { categories: { [p.category]: value } } }).catch(() => refetch());
  }

  return (
    <Screen>
      <Header title={t('push.settings')} fallback="/profile" />
      {isLoading ? <Loading /> : error || !data ? <ErrorState error={error} onRetry={refetch} /> : (
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
          {!pushSupported && <Card><AppText size={13} muted>{t('push.webNote')}</AppText></Card>}
          {pushSupported && system !== 'granted' && system !== 'unsupported' && (
            <Card style={{ gap: 10, backgroundColor: '#FFFBEB' }}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Ionicons name="notifications-off-outline" size={20} color={palette.amberDark} />
                <AppText size={13} style={{ flex: 1 }}>{t('push.systemOff')}</AppText>
              </View>
              {system === 'undetermined' ? (
                <Button title={t('push.enable')} size="md" onPress={async () => { await registerForPush(true); setSystem(await permissionStatus()); }} />
              ) : (
                <Button title={t('push.openSettings')} size="md" variant="secondary" onPress={() => Linking.openSettings()} />
              )}
            </Card>
          )}
          <Card style={{ paddingVertical: 6 }}>
            {data.map((p, i) => (
              <View key={p.category} style={[styles.row, i > 0 && styles.divider]}>
                <View style={{ flex: 1 }}>
                  <AppText weight="semibold" size={15}>{language === 'HI' ? p.labelHi : p.labelEn}</AppText>
                  <AppText size={12} muted>{language === 'HI' ? p.descriptionHi : p.descriptionEn}</AppText>
                  {!p.mutable && <AppText size={11} color={palette.amber} weight="semibold">{t('push.alwaysOn')}</AppText>}
                </View>
                <Switch value={p.push} disabled={!p.mutable} onValueChange={(v) => void toggle(p, v)} trackColor={{ true: palette.amber, false: '#E5E7EB' }} thumbColor="#FFFFFF" accessibilityLabel={`${p.labelEn} ${t('push.pushLabel')}`} />
              </View>
            ))}
          </Card>
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  divider: { borderTopWidth: 1, borderTopColor: '#F1F2F4' },
});
