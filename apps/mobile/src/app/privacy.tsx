import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, ScrollView, Share, View } from 'react-native';
import { Header } from '../components/Header';
import { AppText, Button, Card, Screen } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { palette } from '../theme/tokens';

export default function Privacy() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<'export' | 'delete' | null>(null);

  async function exportData() {
    setBusy('export');
    try {
      const data = await api<unknown>('/v1/me/export');
      const json = JSON.stringify(data, null, 2);
      if (Platform.OS === 'web') {
        const blob = new Blob([json], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'testwise-my-data.json';
        a.click();
      } else {
        await Share.share({ message: json, title: 'testwise-my-data.json' });
      }
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function requestDelete() {
    Alert.alert(t('privacy.deleteTitle'), t('privacy.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('privacy.deleteButton'),
        style: 'destructive',
        onPress: async () => {
          setBusy('delete');
          try {
            const r = await api<{ ticketId: string }>('/v1/me/delete-request', { method: 'POST', body: {} });
            Alert.alert(t('privacy.deleteTitle'), t('privacy.deleteRequested'));
            router.push({ pathname: '/support/[id]', params: { id: r.ticketId } });
          } catch (e) {
            Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  }

  return (
    <Screen>
      <Header title={t('privacy.title')} fallback="/profile" />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        <Card style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><Ionicons name="download-outline" size={22} color={palette.blue} /><AppText weight="bold" size={16}>{t('privacy.exportTitle')}</AppText></View>
          <AppText size={13} muted>{t('privacy.exportBody')}</AppText>
          <Button title={t('privacy.exportButton')} variant="secondary" size="md" onPress={exportData} loading={busy === 'export'} />
        </Card>
        <Card style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><Ionicons name="trash-outline" size={22} color={palette.red} /><AppText weight="bold" size={16}>{t('privacy.deleteTitle')}</AppText></View>
          <AppText size={13} muted>{t('privacy.deleteBody')}</AppText>
          <Button title={t('privacy.deleteButton')} variant="secondary" size="md" onPress={requestDelete} loading={busy === 'delete'} />
        </Card>
      </ScrollView>
    </Screen>
  );
}
