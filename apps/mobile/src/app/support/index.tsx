import { Ionicons } from '@expo/vector-icons';
import type { FaqDto, TicketDto } from '@testwise/shared';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Header } from '../../components/Header';
import { AppText, Button, Card, Loading, Screen } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDateTime, useLocalized } from '../../lib/format';
import { useSession } from '../../lib/session';
import { palette } from '../../theme/tokens';

function Faq({ f }: { f: FaqDto }) {
  const L = useLocalized();
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => setOpen(!open)} style={styles.faq} accessibilityRole="button">
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <AppText weight="semibold" size={14} style={{ flex: 1 }}>{L(f.questionEn, f.questionHi)}</AppText>
        <Ionicons name={open ? 'remove' : 'add'} size={18} color="#9CA3AF" />
      </View>
      {open && <AppText size={13} muted style={{ marginTop: 8 }}>{L(f.answerEn, f.answerHi)}</AppText>}
    </Pressable>
  );
}

export default function Support() {
  const { t } = useTranslation();
  const { config, language } = useSession();
  const contact = config?.['support.contact'];
  const faqs = useQuery({ queryKey: ['faqs'], queryFn: () => api<FaqDto[]>('/v1/support/faqs', { auth: false }) });
  const tickets = useQuery({ queryKey: ['tickets'], queryFn: () => api<TicketDto[]>('/v1/me/tickets') });
  const categories = [...new Set((faqs.data ?? []).map((f) => f.category))];

  return (
    <Screen>
      <Header title={t('support.title')} fallback="/profile" />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40, maxWidth: 760, width: '100%', alignSelf: 'center' }}>
        {contact && (
          <Card style={{ gap: 8 }}>
            <AppText weight="bold" size={16}>{t('support.contact')}</AppText>
            <Pressable onPress={() => Linking.openURL(`mailto:${contact.email}`)} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Ionicons name="mail-outline" size={18} color={palette.amber} />
              <AppText weight="semibold" size={14} color={palette.amber}>{contact.email}</AppText>
            </Pressable>
            <AppText size={12} muted>{language === 'HI' ? contact.hoursHi : contact.hoursEn}</AppText>
          </Card>
        )}

        {contact?.ticketsEnabled !== false && (
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <AppText weight="bold" size={17}>{t('support.tickets')}</AppText>
              <Button title={t('support.newTicket')} size="md" icon="add" onPress={() => router.push('/support/new')} />
            </View>
            {tickets.isLoading ? <Loading /> : !tickets.data?.length ? (
              <AppText size={13} muted>{t('support.noTickets')}</AppText>
            ) : tickets.data.map((tk) => (
              <Pressable key={tk.id} onPress={() => router.push({ pathname: '/support/[id]', params: { id: tk.id } })}>
                <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <AppText weight="bold" size={14} numberOfLines={1}>{tk.subject}</AppText>
                    <AppText size={12} muted>{t(`support.categories.${tk.category}`)} · {formatDateTime(tk.updatedAt, language)}</AppText>
                  </View>
                  <AppText weight="bold" size={12} color={tk.status === 'ANSWERED' ? palette.blue : tk.status === 'OPEN' ? palette.amber : '#9CA3AF'}>{t(`support.status.${tk.status}`)}</AppText>
                </Card>
              </Pressable>
            ))}
          </View>
        )}

        <AppText weight="bold" size={17}>{t('support.faqs')}</AppText>
        {faqs.isLoading ? <Loading /> : categories.map((c) => (
          <View key={c} style={{ gap: 8 }}>
            <AppText weight="bold" size={12} color="#9CA3AF" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>{c}</AppText>
            {faqs.data!.filter((f) => f.category === c).map((f) => <Faq key={f.id} f={f} />)}
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  faq: { padding: 14, borderRadius: 14, backgroundColor: '#F6F7F9' },
});
