import { Ionicons } from '@expo/vector-icons';
import type { TicketDto } from '@testwise/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Header } from '../../components/Header';
import { AppText, ErrorState, Loading, Screen, useFont } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useSession } from '../../lib/session';
import { palette, radius } from '../../theme/tokens';

export default function Ticket() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const { language } = useSession();
  const font = useFont();
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: tk, error, isLoading, refetch } = useQuery({ queryKey: ['ticket', id], queryFn: () => api<TicketDto>(`/v1/me/tickets/${id}`), refetchInterval: 6_000 });

  async function send() {
    setBusy(true);
    try {
      await api(`/v1/me/tickets/${id}/reply`, { method: 'POST', body: { body: reply.trim() } });
      setReply('');
      void refetch();
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <Screen><Loading /></Screen>;
  if (error || !tk) return <Screen><ErrorState error={error} onRetry={refetch} /></Screen>;
  return (
    <Screen edges={['top', 'bottom']}>
      <Header title={tk.subject} fallback="/support" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 10, maxWidth: 760, width: '100%', alignSelf: 'center' }}>
          <AppText size={12} muted>{t(`support.categories.${tk.category}`)} · {t(`support.status.${tk.status}`)}</AppText>
          {tk.messages.map((m) => (
            <View key={m.id} style={[styles.bubble, m.fromAdmin ? styles.admin : styles.mine]}>
              {m.fromAdmin && <AppText weight="bold" size={11} color={palette.blue}>{t('support.team')}</AppText>}
              <AppText size={14}>{m.body}</AppText>
              <AppText size={10} color="#9CA3AF" style={{ marginTop: 4 }}>{formatDateTime(m.createdAt, language)}</AppText>
            </View>
          ))}
        </ScrollView>
        <View style={styles.composer}>
          <TextInput value={reply} onChangeText={setReply} placeholder={t('support.reply')} placeholderTextColor="#9CA3AF" multiline style={{ flex: 1, fontFamily: font('medium'), fontSize: 14, color: palette.ink, maxHeight: 120 }} />
          <Pressable onPress={send} disabled={!reply.trim() || busy} style={[styles.send, (!reply.trim() || busy) && { opacity: 0.4 }]} accessibilityLabel={t('support.send')}>
            <Ionicons name="send" size={18} color="#FFFFFF" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bubble: { padding: 12, borderRadius: radius.md, maxWidth: '85%' },
  mine: { alignSelf: 'flex-end', backgroundColor: '#FFF7E6' },
  admin: { alignSelf: 'flex-start', backgroundColor: '#F3F4F6' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, padding: 12, borderTopWidth: 1, borderTopColor: '#F1F2F4' },
  send: { width: 42, height: 42, borderRadius: 21, backgroundColor: palette.amber, alignItems: 'center', justifyContent: 'center' },
});
