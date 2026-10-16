import { Ionicons } from '@expo/vector-icons';
import { formatRupees, type CheckoutDto, type OrderDto } from '@testwise/shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Linking, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { api, ApiError } from '../lib/api';
import { palette, radius } from '../theme/tokens';
import { AppText, Button } from './ui';

/**
 * Payment sheet. MOCK gateway: simulated pay/fail (test mode, clearly labelled).
 * RAZORPAY: shows the hosted payment page inside the app (WebView; browser fallback on web), then polls the order until it is confirmed.
 */
export function CheckoutSheet({ checkout, onClose, onPaid }: { checkout: CheckoutDto | null; onClose: () => void; onPaid: (o: OrderDto) => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const paidRef = useRef(false);
  const orderId = checkout?.order.id;
  const hosted = !!checkout && checkout.provider !== 'MOCK';
  const inApp = hosted && Platform.OS !== 'web' && !!checkout?.checkoutUrl;

  const poll = async () => {
    if (paidRef.current || !orderId) return;
    try {
      const r = await api<OrderDto>(`/v1/me/orders/${orderId}`);
      if (r.status === 'PAID' && !paidRef.current) {
        paidRef.current = true;
        setMessage({ ok: true, text: t('checkout.success') });
        onPaid(r);
      } else if (r.status === 'FAILED' || r.status === 'CANCELLED') setMessage({ ok: false, text: t('checkout.failed') });
    } catch {
      /* transient network error: next tick retries */
    }
  };

  // Hosted gateway: confirm automatically (poll while open + when the user returns from the payment page).
  useEffect(() => {
    if (!hosted || !orderId) return;
    paidRef.current = false;
    const timer = setInterval(poll, 3000);
    const sub = AppState.addEventListener('change', (st) => st === 'active' && void poll());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hosted, orderId]);

  if (!checkout) return null;
  const o = checkout.order;

  async function mock(outcome: 'success' | 'failure') {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api<OrderDto>(`/v1/payments/mock/${o.id}/pay`, { method: 'POST', body: { outcome } });
      if (r.status === 'PAID') {
        setMessage({ ok: true, text: t('checkout.success') });
        onPaid(r);
      } else setMessage({ ok: false, text: t('checkout.failed') });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiError ? e.message : t('common.error') });
    } finally {
      setBusy(false);
    }
  }

  async function checkStatus() {
    setBusy(true);
    try {
      const r = await api<OrderDto>(`/v1/me/orders/${o.id}`);
      if (r.status === 'PAID') {
        setMessage({ ok: true, text: t('checkout.success') });
        onPaid(r);
      } else if (r.status === 'FAILED' || r.status === 'CANCELLED') setMessage({ ok: false, text: t('checkout.failed') });
      else setMessage({ ok: true, text: t('checkout.pending') });
    } finally {
      setBusy(false);
    }
  }

  if (inApp) {
    return (
      <Modal visible animationType="slide" onRequestClose={onClose}>
        <View style={{ flex: 1, backgroundColor: '#FFFFFF', paddingTop: insets.top }}>
          <View style={[styles.head, { paddingHorizontal: 16, paddingVertical: 12 }]}>
            <View style={{ flex: 1 }}>
              <AppText weight="extrabold" size={17}>{t('checkout.title')}</AppText>
              <AppText size={12} muted numberOfLines={1}>{o.descriptionEn} · {formatRupees(o.amountPaise)}</AppText>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t('common.cancel')}><Ionicons name="close" size={24} color="#6B7280" /></Pressable>
          </View>
          {message && (
            <View style={[styles.msg, { backgroundColor: message.ok ? '#ECFDF5' : '#FEF2F2', marginHorizontal: 16, marginBottom: 8 }]}>
              <Ionicons name={message.ok ? 'checkmark-circle' : 'alert-circle'} size={18} color={message.ok ? palette.green : palette.red} />
              <AppText size={13} color={message.ok ? '#065F46' : palette.red} style={{ flex: 1 }}>{message.text}</AppText>
            </View>
          )}
          <WebView
            source={{ uri: checkout.checkoutUrl! }}
            style={{ flex: 1 }}
            startInLoadingState
            javaScriptEnabled
            domStorageEnabled
            setSupportMultipleWindows={false}
            // UPI apps / banks open through app links (upi://, intent://, tez://...): hand them to the OS instead of failing in the WebView.
            onShouldStartLoadWithRequest={(req) => {
              if (/^https?:|^about:/i.test(req.url)) return true;
              void Linking.openURL(req.url).catch(() => undefined);
              return false;
            }}
            // Razorpay redirects to our /payment-return page after paying: confirm right away.
            onNavigationStateChange={(nav) => nav.url.includes('/payment-return') && void poll()}
          />
          <View style={{ padding: 12, paddingBottom: 12 + insets.bottom }}>
            <Button title={t('checkout.checkStatus')} variant="secondary" onPress={checkStatus} loading={busy} />
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: 20 + insets.bottom }]}>
        <View style={styles.handle} />
        <View style={styles.head}>
          <AppText weight="extrabold" size={20}>{t('checkout.title')}</AppText>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t('common.cancel')}><Ionicons name="close" size={22} color="#6B7280" /></Pressable>
        </View>
        <AppText size={14} muted>{o.descriptionEn}</AppText>
        <View style={styles.box}>
          {o.discountPaise > 0 && (
            <>
              <Row k={t('checkout.total')} v={formatRupees(o.amountPaise + o.discountPaise)} />
              <Row k={`${t('checkout.discount')}${o.couponCode ? ` (${o.couponCode})` : ''}`} v={`−${formatRupees(o.discountPaise)}`} color={palette.green} />
            </>
          )}
          <Row k={t('checkout.payable')} v={formatRupees(o.amountPaise)} strong />
          <AppText size={11} color="#9CA3AF" style={{ marginTop: 6 }}>{t('checkout.receipt', { no: o.receiptNo })}</AppText>
        </View>

        {message && (
          <View style={[styles.msg, { backgroundColor: message.ok ? '#ECFDF5' : '#FEF2F2' }]}>
            <Ionicons name={message.ok ? 'checkmark-circle' : 'alert-circle'} size={18} color={message.ok ? palette.green : palette.red} />
            <AppText size={13} color={message.ok ? '#065F46' : palette.red} style={{ flex: 1 }}>{message.text}</AppText>
          </View>
        )}

        {checkout.provider === 'MOCK' ? (
          <>
            <View style={styles.testMode}>
              <Ionicons name="flask-outline" size={16} color={palette.amberDark} />
              <AppText size={12} color={palette.amberDark} style={{ flex: 1 }}><AppText weight="bold" size={12} color={palette.amberDark}>{t('checkout.testMode')}: </AppText>{t('checkout.testModeBody')}</AppText>
            </View>
            <Button title={t('checkout.payTest', { amount: formatRupees(o.amountPaise) })} icon="phone-portrait-outline" onPress={() => mock('success')} loading={busy} />
            <Button title={t('checkout.failTest')} variant="ghost" onPress={() => mock('failure')} disabled={busy} style={{ marginTop: 4 }} />
          </>
        ) : (
          <>
            <Button title={t('checkout.secure')} icon="lock-closed" onPress={() => checkout.checkoutUrl && Linking.openURL(checkout.checkoutUrl)} disabled={!checkout.checkoutUrl} />
            <Button title={t('checkout.checkStatus')} variant="secondary" onPress={checkStatus} loading={busy} style={{ marginTop: 10 }} />
          </>
        )}
      </View>
    </Modal>
  );
}

function Row({ k, v, strong, color }: { k: string; v: string; strong?: boolean; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
      <AppText size={14} muted={!strong} weight={strong ? 'bold' : 'regular'}>{k}</AppText>
      <AppText size={strong ? 18 : 14} weight={strong ? 'extrabold' : 'semibold'} color={color}>{v}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: 20, gap: 12, maxWidth: 560, width: '100%', alignSelf: 'center' },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB', alignSelf: 'center' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  box: { backgroundColor: '#F6F7F9', borderRadius: radius.md, padding: 14 },
  msg: { flexDirection: 'row', gap: 8, alignItems: 'center', padding: 12, borderRadius: 12 },
  testMode: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: 12, backgroundColor: '#FFFBEB' },
});
