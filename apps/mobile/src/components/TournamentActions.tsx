import { Ionicons } from '@expo/vector-icons';
import { formatRupees, type CheckoutDto, type MyTournamentStateDto, type TournamentDetailDto } from '@testwise/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { api, ApiError } from '../lib/api';
import { newKey, useLocalized } from '../lib/format';
import { routeToDeviceCheck } from '../lib/proctor/startProctored';
import { palette } from '../theme/tokens';
import { CheckoutSheet } from './Checkout';
import { AppText, Button } from './ui';
import { useTournamentClock } from './TournamentCard';

/** Footer actions for a tournament, driven entirely by the server's view of this student's state. */
export function TournamentActions({ d }: { d: TournamentDetailDto }) {
  const { t } = useTranslation();
  const L = useLocalized();
  const qc = useQueryClient();
  const clock = useTournamentClock(d);
  const [checkout, setCheckout] = useState<CheckoutDto | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: me, refetch } = useQuery({
    queryKey: ['tournament-me', d.slug],
    queryFn: () => api<MyTournamentStateDto>(`/v1/tournaments/${d.slug}/me`),
    refetchInterval: d.status === 'LIVE' || d.status === 'REG_OPEN' ? 20_000 : false,
  });

  const refresh = () => {
    void refetch();
    void qc.invalidateQueries({ queryKey: ['tournament', d.slug] });
    void qc.invalidateQueries({ queryKey: ['home'] });
    void qc.invalidateQueries({ queryKey: ['my-tournaments'] });
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof ApiError ? (e.status === 0 ? t('common.offline') : e.message) : String(e));
    } finally {
      setBusy(false);
    }
  };

  const register = () =>
    run(async () => {
      const r = await api<{ status: string; checkout: CheckoutDto | null }>(`/v1/tournaments/${d.slug}/register`, { method: 'POST', body: { idempotencyKey: newKey() } });
      if (r.checkout && !r.checkout.completed) setCheckout(r.checkout);
      refresh();
    });

  const cancel = () =>
    Alert.alert(t('register.cancel'), t('register.cancelConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('register.cancel'), style: 'destructive', onPress: () => run(async () => { await api(`/v1/tournaments/${d.slug}/cancel`, { method: 'POST' }); refresh(); }) },
    ]);

  const start = () =>
    run(async () => {
      try {
        const paper = await api<{ attemptId: string }>(`/v1/tournaments/${d.slug}/attempt`, { method: 'POST' });
        router.push({ pathname: '/exam/[attemptId]', params: { attemptId: paper.attemptId } });
      } catch (e) {
        if (!routeToDeviceCheck(e, { kind: 'tournament', ref: d.slug })) throw e;
      }
    });

  const reg = me?.registration;
  const status = reg?.status;
  const fee = d.entryMode === 'FREE' ? t('common.free') : formatRupees(d.entryFeePaise);

  let badge: { icon: keyof typeof Ionicons.glyphMap; text: string; color: string } | null = null;
  if (status === 'CONFIRMED') badge = { icon: 'checkmark-circle', text: t('register.registered'), color: palette.green };
  else if (status === 'WAITLISTED') badge = { icon: 'hourglass-outline', text: t('register.waitlisted'), color: palette.amber };
  else if (status === 'PENDING_PAYMENT') badge = { icon: 'card-outline', text: t('register.pendingPayment'), color: palette.amber };
  else if (me && !me.eligible && d.status === 'REG_OPEN') badge = { icon: 'alert-circle-outline', text: L(me.ineligibleReasonEn, me.ineligibleReasonHi) ?? '', color: '#FCA5A5' };

  let primary: { title: string; onPress?: () => void; disabled?: boolean } = { title: t('tournament.registrationClosed'), disabled: true };
  if (d.status === 'CANCELLED') primary = { title: t('tournament.cancelled'), disabled: true };
  else if (me?.canStart) primary = { title: me.attempt?.status === 'IN_PROGRESS' ? t('register.resume') : t('register.start'), onPress: start };
  else if (me?.attempt && me.attempt.status !== 'IN_PROGRESS') primary = { title: t('register.viewResults'), onPress: () => router.push({ pathname: '/tournament/[slug]/results', params: { slug: d.slug } }) };
  else if (me?.resultAvailable && ['LIVE', 'IN_REVIEW', 'FINAL', 'REWARDS_APPROVED', 'CLOSED'].includes(d.status)) primary = { title: t('register.viewResults'), onPress: () => router.push({ pathname: '/tournament/[slug]/results', params: { slug: d.slug } }) };
  else if (status === 'PENDING_PAYMENT' && me?.canRegister) primary = { title: t('register.payNow'), onPress: register };
  else if (status === 'CONFIRMED' && (d.status === 'REG_OPEN' || d.status === 'REG_CLOSED')) primary = { title: `${t('tournament.startsIn')} ${clock.value}`, disabled: true };
  else if (status === 'WAITLISTED') primary = { title: t('register.waitlisted'), disabled: true };
  else if (d.status === 'REG_OPEN') primary = { title: `${t('tournament.register')} · ${fee}`, onPress: register, disabled: !me?.canRegister };
  else if (d.status === 'SCHEDULED') primary = { title: `${t('tournament.regOpensIn')} ${clock.value}`, disabled: true };

  return (
    <>
      {badge && (
        <View style={styles.badge}>
          <Ionicons name={badge.icon} size={16} color={badge.color} />
          <AppText weight="semibold" size={13} color={badge.color} style={{ flex: 1 }}>{badge.text}</AppText>
          {me?.canCancel && (
            <Pressable onPress={cancel} hitSlop={8}>
              <AppText weight="bold" size={12} color="rgba(255,255,255,0.6)">{t('register.cancel')}</AppText>
            </Pressable>
          )}
        </View>
      )}
      <Button title={primary.title} onPress={primary.onPress} disabled={primary.disabled || busy} loading={busy} />
      <CheckoutSheet
        checkout={checkout}
        onClose={() => { setCheckout(null); refresh(); }}
        onPaid={() => { setTimeout(() => setCheckout(null), 900); refresh(); }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
});
