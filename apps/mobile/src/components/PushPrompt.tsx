import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { permissionStatus, registerForPush, wasAsked } from '../lib/push';
import { storage } from '../lib/storage';
import { palette, radius } from '../theme/tokens';
import { AppText, Button } from './ui';

/** One-time explanation before the system permission prompt. */
export function PushPrompt() {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => setShow((await permissionStatus()) === 'undetermined' && !(await wasAsked())))();
  }, []);

  if (!show) return null;
  return (
    <View style={styles.card}>
      <View style={styles.icon}><Ionicons name="notifications" size={22} color="#FFFFFF" /></View>
      <View style={{ flex: 1, gap: 4 }}>
        <AppText weight="bold" size={15} color="#FFFFFF">{t('push.title')}</AppText>
        <AppText size={12} color="rgba(255,255,255,0.8)">{t('push.body')}</AppText>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <Button title={t('push.enable')} size="md" loading={busy} onPress={async () => { setBusy(true); await registerForPush(true); setBusy(false); setShow(false); }} style={{ paddingHorizontal: 14 }} />
          <Button title={t('push.later')} size="md" variant="ghost" onPress={async () => { await storage.set('tw_push_asked', '1'); setShow(false); }} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', gap: 12, padding: 16, borderRadius: radius.lg, backgroundColor: '#0B1530' },
  icon: { width: 44, height: 44, borderRadius: 14, backgroundColor: palette.amber, alignItems: 'center', justifyContent: 'center' },
});
