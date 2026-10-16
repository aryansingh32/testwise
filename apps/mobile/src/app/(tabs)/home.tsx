import { Ionicons } from '@expo/vector-icons';
import type { BannerDto, ExamDto, HomeDto, HomeSectionDto, TournamentCardDto } from '@testwise/shared';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { PushPrompt } from '../../components/PushPrompt';
import { RewardsCard } from '../../components/RewardsCard';
import { TournamentCard } from '../../components/TournamentCard';
import { AppText, Avatar, Card, ErrorState, Loading, Screen, SectionHeader } from '../../components/ui';
import { api } from '../../lib/api';
import { CoinIcon, fmtCoins, useWallet } from '../../components/Wallet';
import { useLocalized } from '../../lib/format';
import { useSession } from '../../lib/session';
import { palette, radius } from '../../theme/tokens';

const EXAM_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  briefcase: 'briefcase', landmark: 'business', atom: 'planet', stethoscope: 'medkit', scale: 'library',
  train: 'train', school: 'school', graduation: 'ribbon', trophy: 'trophy', book: 'book',
};

function Banners({ items, width }: { items: BannerDto[]; width: number }) {
  const L = useLocalized();
  const cardW = Math.min(width * 0.86, 420);
  const open = (b: BannerDto) => {
    if (b.linkType === 'TOURNAMENT' && b.linkTarget) router.push({ pathname: '/tournament/[slug]', params: { slug: b.linkTarget } });
    else if (b.linkType === 'SERIES' && b.linkTarget) router.push({ pathname: '/series/[slug]', params: { slug: b.linkTarget } });
    else if (b.linkType === 'URL' && b.linkTarget) void Linking.openURL(b.linkTarget);
    else if (b.linkType === 'EXAM') router.push('/arena');
  };
  return (
    <FlatList
      horizontal
      data={items}
      keyExtractor={(b) => b.id}
      showsHorizontalScrollIndicator={false}
      snapToInterval={cardW + 14}
      decelerationRate="fast"
      contentContainerStyle={{ paddingHorizontal: 20, gap: 14 }}
      renderItem={({ item: b }) => (
        <Pressable onPress={() => open(b)} style={[styles.banner, { width: cardW, backgroundColor: b.color }]} accessibilityRole="button">
          <View style={styles.bannerCircle} />
          <View style={[styles.bannerCircle, { right: 40, top: 90, width: 90, height: 90, opacity: 0.6 }]} />
          <View style={{ width: '70%' }}>
            {b.tagEn && (
              <View style={styles.bannerTag}>
                <AppText weight="bold" size={10} color="#FFFFFF" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>{L(b.tagEn, b.tagHi)}</AppText>
              </View>
            )}
            <AppText weight="extrabold" size={20} color="#FFFFFF" style={{ marginTop: 8 }} numberOfLines={2}>{L(b.titleEn, b.titleHi)}</AppText>
            {b.subtitleEn && <AppText size={12} color="rgba(255,255,255,0.85)" style={{ marginTop: 4 }} numberOfLines={2}>{L(b.subtitleEn, b.subtitleHi)}</AppText>}
          </View>
          {b.ctaEn && (
            <View style={styles.bannerCta}>
              <AppText weight="bold" size={12} color={b.color}>{L(b.ctaEn, b.ctaHi)}</AppText>
              <Ionicons name="arrow-forward" size={12} color={b.color} />
            </View>
          )}
        </Pressable>
      )}
    />
  );
}

function TournamentsRail({ items, width }: { items: TournamentCardDto[]; width: number }) {
  const { t } = useTranslation();
  if (!items.length) return <AppText muted style={{ paddingHorizontal: 20 }}>{t('home.noTournaments')}</AppText>;
  const cardW = Math.min(width * 0.78, 360);
  return (
    <FlatList
      horizontal
      data={items}
      keyExtractor={(i) => i.id}
      showsHorizontalScrollIndicator={false}
      snapToInterval={cardW + 14}
      decelerationRate="fast"
      contentContainerStyle={{ paddingHorizontal: 20, gap: 14 }}
      renderItem={({ item }) => <TournamentCard t={item} width={cardW} />}
    />
  );
}

function Exams({ items }: { items: ExamDto[] }) {
  const L = useLocalized();
  return (
    <View style={styles.examGrid}>
      {items.slice(0, 8).map((e) => (
        <Pressable key={e.id} style={styles.examItem} onPress={() => router.push({ pathname: '/arena', params: { exam: e.id } })} accessibilityRole="button">
          <View style={[styles.examIcon, { backgroundColor: e.color + '1A' }]}>
            <Ionicons name={EXAM_ICONS[e.icon] ?? 'book'} size={22} color={e.color} />
          </View>
          <AppText weight="bold" size={11} muted numberOfLines={1} style={{ textAlign: 'center' }}>{L(e.nameEn, e.nameHi)}</AppText>
        </Pressable>
      ))}
    </View>
  );
}

/** Coin balance chip for the top bar; taps through to the wallet. Hidden when the wallet is switched off. */
function CoinPill() {
  const { t } = useTranslation();
  const { config } = useSession();
  const enabled = !!config?.['wallet.settings']?.enabled;
  const w = useWallet();
  if (!enabled) return null;
  return (
    <Pressable style={styles.coinPill} onPress={() => router.push('/wallet')} accessibilityRole="button" accessibilityLabel={t('wallet.title')}>
      <CoinIcon size={18} />
      <AppText weight="extrabold" size={13}>{w.data ? fmtCoins(w.data.wallet.available) : '–'}</AppText>
    </Pressable>
  );
}

function Section({ s, data, width }: { s: HomeSectionDto; data: HomeDto; width: number }) {
  const { t } = useTranslation();
  const L = useLocalized();
  const { user } = useSession();
  const title = L(s.titleEn, s.titleHi) || s.titleEn;
  switch (s.key) {
    case 'LIVE_TOURNAMENTS':
      return (
        <View style={styles.section}>
          <View style={{ paddingHorizontal: 20 }}><SectionHeader title={title} action={t('common.seeAll')} onAction={() => router.push('/arena')} /></View>
          <TournamentsRail items={data.tournaments} width={width} />
        </View>
      );
    case 'DAILY_MISSIONS':
      if (!data.missions.length) return null;
      return (
        <View style={[styles.section, styles.pad]}>
          <SectionHeader title={title} />
          <Card style={{ gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={styles.streakIcon}><Ionicons name="flame" size={24} color="#FFFFFF" /></View>
              <View style={{ flex: 1 }}>
                <AppText weight="extrabold" size={16}>{t('home.streak', { count: user?.streakDays ?? 1 })}</AppText>
                <AppText size={12} muted>{t('home.streakKeep')}</AppText>
              </View>
              <View style={styles.xpPill}><Ionicons name="flash" size={12} color={palette.amber} /><AppText weight="extrabold" size={12}>{data.xp} XP</AppText></View>
            </View>
            {data.missions.map((m) => (
              <View key={m.id} style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name={m.done ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={m.done ? palette.green : '#D1D5DB'} />
                  <AppText weight="semibold" size={13} style={{ flex: 1 }}>{L(m.titleEn, m.titleHi)}</AppText>
                  <AppText weight="bold" size={12} color={m.done ? palette.green : palette.amber}>{m.done ? t('missions.done') : `+${m.xp} XP`}</AppText>
                </View>
                {!m.done && m.target > 1 && (
                  <View style={styles.missionBar}><View style={[styles.missionFill, { width: `${(m.progress / m.target) * 100}%` }]} /></View>
                )}
              </View>
            ))}
          </Card>
        </View>
      );
    case 'CONTINUE_LEARNING':
      if (!data.continueLearning.length) return null;
      return (
        <View style={[styles.section, styles.pad]}>
          <SectionHeader title={title} action={t('common.seeAll')} onAction={() => router.push('/tests')} />
          <View style={{ gap: 12 }}>
            {data.continueLearning.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => (c.attemptId ? router.push({ pathname: '/exam/[attemptId]', params: { attemptId: c.attemptId } }) : router.push({ pathname: '/series/[slug]', params: { slug: c.seriesSlug! } }))}
              >
                <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <View style={[styles.streakIcon, { backgroundColor: c.color }]}><Ionicons name={c.kind === 'ATTEMPT' ? 'play' : 'library'} size={22} color="#FFFFFF" /></View>
                  <View style={{ flex: 1, gap: 6 }}>
                    <AppText weight="bold" size={14} numberOfLines={1}>{L(c.titleEn, c.titleHi)}</AppText>
                    <View style={styles.missionBar}><View style={[styles.missionFill, { width: `${c.total ? (c.progress / c.total) * 100 : 0}%`, backgroundColor: palette.green }]} /></View>
                    <AppText size={11} muted>{c.progress}/{c.total}</AppText>
                  </View>
                  <View style={styles.resume}><AppText weight="bold" size={11} color="#FFFFFF">{c.kind === 'ATTEMPT' ? t('store.resume') : t('store.start')}</AppText></View>
                </Card>
              </Pressable>
            ))}
          </View>
        </View>
      );
    case 'POPULAR_EXAMS':
      return data.exams.length ? (
        <View style={[styles.section, styles.pad]}>
          <SectionHeader title={title} />
          <Exams items={data.exams} />
        </View>
      ) : null;
    case 'LEADERBOARD':
      if (!data.leaderboard.length) return null;
      return (
        <View style={[styles.section, styles.pad]}>
          <View style={styles.leaderboard}>
            <AppText weight="bold" size={16} color="#FFFFFF" style={{ marginBottom: 12 }}>{title}</AppText>
            {data.leaderboard.map((e, i) => (
              <View key={e.userId} style={[styles.lbRow, e.isMe && styles.lbMe]}>
                <AppText weight="extrabold" color={i === 0 ? palette.amber : '#9CA3AF'} style={{ width: 18 }}>{e.rank}</AppText>
                <Avatar name={e.displayName} size={34} ring={i} />
                <AppText weight="semibold" size={14} color="#FFFFFF" style={{ flex: 1 }} numberOfLines={1}>{e.displayName}</AppText>
                <AppText weight="bold" size={12} color={palette.green}>{e.points} XP</AppText>
              </View>
            ))}
          </View>
        </View>
      );
    default:
      return null;
  }
}

export default function Home() {
  const { t } = useTranslation();
  const { user } = useSession();
  const { width } = useWindowDimensions();
  const { data, error, isLoading, refetch, isRefetching } = useQuery({ queryKey: ['home'], queryFn: () => api<HomeDto>('/v1/home'), refetchInterval: 30_000 });
  const firstName = user?.displayName.split(' ')[0] ?? '';

  return (
    <Screen>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={styles.logo}><Ionicons name="trophy" size={20} color="#FFFFFF" /></View>
          <View>
            <AppText weight="extrabold" size={20} style={{ lineHeight: 22 }}>Test<AppText weight="extrabold" size={20} color={palette.amber}>wise</AppText></AppText>
            <AppText weight="semibold" size={9} color="#9CA3AF" style={{ letterSpacing: 1.5 }}>{t('common.tagline').toUpperCase()}</AppText>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={styles.streakPill}>
            <Ionicons name="flame" size={14} color={palette.amber} />
            <AppText weight="extrabold" size={13}>{user?.streakDays ?? 1}</AppText>
          </View>
          <CoinPill />
          <Pressable style={styles.iconBtn} onPress={() => router.push('/notifications')} accessibilityLabel={t('notifications.title')}>
            <Ionicons name="notifications-outline" size={20} color="#6B7280" />
            {!!data?.unreadNotifications && <View style={styles.badge}><AppText weight="extrabold" size={9} color="#FFFFFF">{data.unreadNotifications > 9 ? '9+' : data.unreadNotifications}</AppText></View>}
          </Pressable>
        </View>
      </View>

      {isLoading ? (
        <Loading />
      ) : error || !data ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <ScrollView refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={palette.amber} />} contentContainerStyle={{ paddingBottom: 32 }}>
          <View style={[styles.pad, { marginTop: 4 }]}>
            <AppText muted weight="medium" size={14}>{t('home.hello', { name: firstName })}</AppText>
            <AppText weight="extrabold" size={24} style={{ marginTop: 2 }}>
              {t('home.headline')} <AppText weight="extrabold" size={24} color={palette.blue}>{t('home.headlineAccent')}</AppText>
            </AppText>
          </View>
          <View style={[styles.pad, { marginTop: 16 }]}><PushPrompt /></View>
          <View style={[styles.pad, { marginTop: 12 }]}><RewardsCard /></View>
          {data.banners.length > 0 && <View style={{ marginTop: 20 }}><Banners items={data.banners} width={width} /></View>}
          {data.sections.map((s) => <Section key={s.key} s={s} data={data} width={width} />)}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12 },
  logo: { width: 40, height: 40, borderRadius: 12, backgroundColor: palette.amber, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F6F7F9', alignItems: 'center', justifyContent: 'center' },
  streakPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFF9F0', paddingHorizontal: 12, borderRadius: 20 },
  coinPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#FFFBEB', paddingHorizontal: 10, borderRadius: 20 },
  pad: { paddingHorizontal: 20 },
  section: { marginTop: 28 },
  banner: { height: 172, borderRadius: radius.lg, padding: 20, overflow: 'hidden', justifyContent: 'space-between' },
  bannerCircle: { position: 'absolute', right: -30, top: -30, width: 150, height: 150, borderRadius: 75, backgroundColor: 'rgba(255,255,255,0.14)' },
  bannerTag: { alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.22)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  bannerCta: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: '#FFFFFF', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  streakIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: palette.amber, alignItems: 'center', justifyContent: 'center' },
  examGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 16 },
  examItem: { width: '25%', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  examIcon: { width: 60, height: 60, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  leaderboard: { backgroundColor: palette.ink, borderRadius: radius.lg, padding: 20 },
  lbRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8, padding: 6, borderRadius: 12 },
  lbMe: { backgroundColor: 'rgba(245,158,11,0.15)' },
  badge: { position: 'absolute', top: 4, right: 4, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: palette.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  xpPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFF9F0', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  missionBar: { height: 6, borderRadius: 3, backgroundColor: '#F1F2F4', overflow: 'hidden' },
  missionFill: { height: '100%', borderRadius: 3, backgroundColor: palette.amber },
  resume: { backgroundColor: palette.ink, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
});
