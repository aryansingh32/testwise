import type { TicketDto } from '@testwise/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Header } from '../../components/Header';
import { AppText, Button, Input, Screen } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { palette } from '../../theme/tokens';

const CATEGORIES = ['GENERAL', 'PAYMENT', 'RESULT_APPEAL', 'TECHNICAL', 'ACCOUNT'] as const;

export default function NewTicket() {
  const params = useLocalSearchParams<{ category?: string; tournamentId?: string; orderId?: string; subject?: string }>();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [category, setCategory] = useState<string>(params.category ?? 'GENERAL');
  const [subject, setSubject] = useState(params.subject ?? '');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const tk = await api<TicketDto>('/v1/me/tickets', {
        method: 'POST',
        body: { category, subject: subject.trim(), message: message.trim(), tournamentId: params.tournamentId ?? null, orderId: params.orderId ?? null },
      });
      void qc.invalidateQueries({ queryKey: ['tickets'] });
      router.replace({ pathname: '/support/[id]', params: { id: tk.id } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <Header title={t('support.newTicket')} fallback="/support" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16, maxWidth: 560, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
          <AppText weight="semibold" size={12} muted>{t('support.category')}</AppText>
          <View style={styles.chips}>
            {CATEGORIES.map((c) => (
              <Pressable key={c} onPress={() => setCategory(c)} style={[styles.chip, category === c && styles.chipOn]}>
                <AppText weight="bold" size={13} color={category === c ? palette.amber : palette.ink}>{t(`support.categories.${c}`)}</AppText>
              </Pressable>
            ))}
          </View>
          <Input label={t('support.subject')} value={subject} onChangeText={setSubject} />
          <Input label={t('support.message')} value={message} onChangeText={setMessage} multiline style={{ minHeight: 120, textAlignVertical: 'top' }} />
          {error && <AppText size={13} color={palette.red}>{error}</AppText>}
          <Button title={t('support.send')} onPress={send} loading={busy} disabled={subject.trim().length < 3 || message.trim().length < 3} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: -8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, borderWidth: 2, borderColor: '#EEF0F3' },
  chipOn: { borderColor: palette.amber, backgroundColor: '#FFFBEB' },
});
