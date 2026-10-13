import { Ionicons } from '@expo/vector-icons';
import type { DuelFinishedDto, DuelPlayerDto, DuelQuestionDto, DuelQuestionResultDto } from '@testwise/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Animated, Easing, Image, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Avatar, Button, Screen, arena } from '../../components/ui';
import { api } from '../../lib/api';
import { duelSocket, emitAck } from '../../lib/duelSocket';
import { useLocalized } from '../../lib/format';
import { formatMath } from '../../lib/math';
import { palette, radius } from '../../theme/tokens';

type Phase = 'connecting' | 'searching' | 'hosting' | 'waitingHost' | 'intro' | 'question' | 'finished' | 'error';
interface Matched { duelId: string; you: DuelPlayerDto; opponent: DuelPlayerDto; questionCount: number; secondsPerQuestion: number; startsAt: string; mode: string; scores?: { you: number; opponent: number } }
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function Orbit() {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 6000, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const counter = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-360deg'] });
  const names = ['Aarav M', 'Ishita R', 'Kabir S', 'Diya P', 'Rohan V'];
  return (
    <View style={styles.orbitWrap}>
      <View style={[styles.ring, { width: 300, height: 300 }]} />
      <View style={[styles.ring, { width: 200, height: 200 }]} />
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate }] }]}>
        {names.map((n, i) => {
          const angle = (i / names.length) * Math.PI * 2;
          return <Animated.View key={n} style={{ position: 'absolute', left: 150 + Math.cos(angle) * 140 - 24, top: 150 + Math.sin(angle) * 140 - 24, transform: [{ rotate: counter }] }}><Avatar name={n} size={48} ring={i + 1} /></Animated.View>;
        })}
      </Animated.View>
    </View>
  );
}

function PlayerBadge({ p, score, align }: { p: DuelPlayerDto; score: number; align: 'left' | 'right' }) {
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: align === 'left' ? 'row' : 'row-reverse', alignItems: 'center', gap: 8, flex: 1 }}>
      <View style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 3, borderColor: p.color, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1E293B' }}>
        <AppText weight="extrabold" size={14} color="#FFFFFF">{p.name.split(' ').map((x) => x[0]).slice(0, 2).join('')}</AppText>
      </View>
      <View style={{ alignItems: align === 'left' ? 'flex-start' : 'flex-end', flexShrink: 1 }}>
        <AppText weight="bold" size={12} color="#FFFFFF" numberOfLines={1}>{align === 'left' ? t('results.you') : p.name}</AppText>
        <AppText weight="extrabold" size={20} color={palette.amber}>{score}</AppText>
      </View>
    </View>
  );
}

export default function DuelPlay() {
  const params = useLocalSearchParams<{ examId?: string; host?: string; code?: string; join?: string; paid?: string; room?: string; entry?: string; prize?: string }>();
  const { t } = useTranslation();
  const L = useLocalized();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Phase>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [waited, setWaited] = useState(0);
  const [match, setMatch] = useState<Matched | null>(null);
  const [question, setQuestion] = useState<DuelQuestionDto | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [oppAnswered, setOppAnswered] = useState(false);
  const [reveal, setReveal] = useState<DuelQuestionResultDto | null>(null);
  const [scores, setScores] = useState({ you: 0, opponent: 0 });
  const [finished, setFinished] = useState<DuelFinishedDto | null>(null);
  const [rematchState, setRematchState] = useState<'idle' | 'waiting' | 'offered' | 'declined'>('idle');
  const [offerFrom, setOfferFrom] = useState('');
  const [now, setNow] = useState(Date.now());
  const offset = useRef(0);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const ratingAnim = useRef(new Animated.Value(0)).current;
  const [ratingShown, setRatingShown] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const s = duelSocket();
    const onConnect = async () => {
      if (params.host) {
        const r = await emitAck<{ ok: boolean; error?: string }>('challenge:wait', { duelId: params.host });
        if (!r.ok) return fail(r.error ?? t('common.error'));
        if (phaseRef.current === 'connecting') setPhase('hosting');
      } else if (params.join) {
        const r = await emitAck<{ ok: boolean; error?: string }>('challenge:join', { code: params.join });
        if (!r.ok) return fail(r.error ?? t('common.error'));
      } else if (params.paid) {
        // Coin duel: the seat and the escrowed entry were taken over HTTP; the server starts the duel when both players are here.
        if (phaseRef.current === 'connecting') setPhase('searching');
      } else if (phaseRef.current === 'connecting' || phaseRef.current === 'searching') {
        const r = await emitAck<{ ok: boolean; error?: string; resumed?: boolean }>('queue:join', { examId: params.examId || null });
        if (!r.ok) return fail(r.error ?? t('common.error'));
        if (!r.resumed) setPhase('searching');
      } else {
        s.emit('duel:state');
      }
    };
    const fail = (m: string) => { setError(m); setPhase('error'); };
    s.on('connect', onConnect);
    s.on('connect_error', () => setError(t('duels.disconnected')));
    s.on('queue:searching', (d: { waitedSec: number }) => setWaited(d.waitedSec));
    s.on('queue:error', (d: { message: string }) => fail(d.message));
    s.on('challenge:joined', () => setPhase('waitingHost'));
    s.on('duel:matched', (m: Matched) => {
      offset.current = 0;
      setMatch(m);
      setFinished(null);
      setRematchState('idle');
      setScores(m.scores ?? { you: 0, opponent: 0 });
      setReveal(null);
      setQuestion(null);
      setPhase(m.scores ? 'question' : 'intro');
    });
    s.on('duel:question', (q: DuelQuestionDto & { alreadyAnswered?: boolean }) => {
      offset.current = new Date(q.serverNow).getTime() - Date.now();
      setQuestion(q);
      setPicked(q.alreadyAnswered ? '?' : null);
      setOppAnswered(false);
      setReveal(null);
      setPhase('question');
    });
    s.on('duel:opponent_answered', () => setOppAnswered(true));
    s.on('duel:question_result', (r: DuelQuestionResultDto) => { setReveal(r); setScores(r.scores); });
    s.on('duel:finished', (f: DuelFinishedDto) => {
      setFinished(f);
      setScores(f.scores);
      setPhase('finished');
      ratingAnim.setValue(0);
      Animated.timing(ratingAnim, { toValue: 1, duration: 1400, delay: 500, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
      void qc.invalidateQueries({ queryKey: ['wallet'] });
      void qc.invalidateQueries({ queryKey: ['paid-duels'] });
      void qc.invalidateQueries({ queryKey: ['duel-profile'] });
      void qc.invalidateQueries({ queryKey: ['duel-history'] });
      void qc.invalidateQueries({ queryKey: ['duel-leaderboard'] });
    });
    s.on('rematch:offer', (d: { from: string }) => { setOfferFrom(d.from); setRematchState('offered'); });
    s.on('rematch:declined', () => setRematchState('declined'));
    if (s.connected) void onConnect();
    else s.connect();
    return () => {
      if (phaseRef.current === 'searching') {
        if (params.paid && params.room) void api(`/v1/duels/paid/rooms/${params.room}/leave`, { method: 'POST' }).then(() => qc.invalidateQueries({ queryKey: ['wallet'] })).catch(() => undefined);
        else s.emit('queue:leave');
      }
      ['connect', 'connect_error', 'queue:searching', 'queue:error', 'challenge:joined', 'duel:matched', 'duel:question', 'duel:opponent_answered', 'duel:question_result', 'duel:finished', 'rematch:offer', 'rematch:declined'].forEach((e) => s.off(e));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!finished) return;
    const id = ratingAnim.addListener(({ value }) => setRatingShown(Math.round(finished.ratingBefore + (finished.ratingAfter - finished.ratingBefore) * value)));
    return () => ratingAnim.removeListener(id);
  }, [finished, ratingAnim]);

  // Leaving mid-duel forfeits; confirm first.
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (phaseRef.current !== 'question' && phaseRef.current !== 'intro') return;
      e.preventDefault();
      Alert.alert(t('duels.leaveTitle'), t('duels.leaveBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('duels.leave'), style: 'destructive', onPress: () => { duelSocket().emit('duel:forfeit', { duelId: match?.duelId }); navigation.dispatch(e.data.action); } },
      ]);
    });
    return unsub;
  }, [navigation, match?.duelId, t]);

  function answer(label: string) {
    if (!question || !match || picked || reveal) return;
    setPicked(label);
    duelSocket().emit('duel:answer', { duelId: match.duelId, index: question.index, label });
  }

  const remainingMs = question ? Math.max(0, new Date(question.endsAt).getTime() - (now + offset.current)) : 0;
  const fraction = question && match ? remainingMs / (match.secondsPerQuestion * 1000) : 0;
  const introLeft = match ? Math.max(0, Math.ceil((new Date(match.startsAt).getTime() - now) / 1000)) : 0;

  // ----------------------------------------------------------- Screens
  if (phase === 'error') {
    return (
      <Screen theme={arena}>
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={42} color={palette.amber} />
          <AppText weight="bold" size={16} theme={arena} style={{ textAlign: 'center' }}>{error}</AppText>
          <Button title={t('duels.backToArena')} variant="light" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  if (phase === 'connecting' || phase === 'searching' || phase === 'hosting' || phase === 'waitingHost') {
    const hosting = phase === 'hosting';
    return (
      <Screen theme={arena} edges={['top', 'bottom']}>
        <View style={styles.center}>
          {hosting ? (
            <>
              <AppText weight="extrabold" size={24} theme={arena}>{t('duels.hostTitle')}</AppText>
              <AppText size={14} theme={arena} muted style={{ textAlign: 'center' }}>{t('duels.hostBody')}</AppText>
              <View style={styles.codeBox}><AppText weight="extrabold" size={40} color="#FFFFFF" style={{ letterSpacing: 8 }}>{params.code}</AppText></View>
              <Button title={t('duels.shareCode')} icon="share-social" onPress={() => Share.share({ message: t('duels.shareText', { code: params.code }) })} />
              <AppText size={13} theme={arena} muted>{t('duels.waitingFriend')}</AppText>
            </>
          ) : (
            <>
              <Orbit />
              <AppText weight="extrabold" size={26} theme={arena} style={{ fontStyle: 'italic' }}>{phase === 'waitingHost' ? t('duels.waitingHost') : params.paid ? t('coinDuels.waiting') : t('duels.searching')}</AppText>
              {phase === 'searching' && !params.paid && <AppText size={13} theme={arena} muted>{t('duels.searchingFor', { s: waited })}</AppText>}
              {phase === 'searching' && params.paid && (
                <>
                  <AppText size={13} theme={arena} muted style={{ textAlign: 'center', paddingHorizontal: 24 }}>{t('coinDuels.waitingBody', { coins: params.entry ?? '' })}</AppText>
                  <Button title={t('coinDuels.leave')} variant="light" onPress={() => router.back()} />
                </>
              )}
              {phase === 'connecting' && <AppText size={13} theme={arena} muted>{error ?? t('duels.connecting')}</AppText>}
            </>
          )}
        </View>
        <View style={{ padding: 20 }}>
          <Button title={t('duels.cancel')} variant="light" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  if (phase === 'intro' && match) {
    return (
      <Screen theme={arena}>
        <View style={styles.center}>
          <AppText weight="extrabold" size={22} theme={arena}>{t('duels.getReady')}</AppText>
          <View style={styles.vsRow}>
            <View style={{ alignItems: 'center', gap: 6 }}><Avatar name={match.you.name} size={88} ring={0} /><AppText weight="bold" theme={arena}>{t('results.you')}</AppText><AppText weight="extrabold" color={palette.amber}>{match.you.rating}</AppText></View>
            <AppText weight="extrabold" size={30} color={palette.amber} style={{ fontStyle: 'italic' }}>{t('duels.vs')}</AppText>
            <View style={{ alignItems: 'center', gap: 6 }}><Avatar name={match.opponent.name} size={88} ring={1} /><AppText weight="bold" theme={arena}>{match.opponent.name}</AppText><AppText weight="extrabold" color="#F472B6">{match.opponent.rating}</AppText></View>
          </View>
          <AppText weight="extrabold" size={64} color="#FFFFFF">{introLeft || '⚡'}</AppText>
        </View>
      </Screen>
    );
  }

  if (phase === 'question' && match) {
    const q = question;
    return (
      <Screen theme={arena} edges={['top']}>
        <View style={styles.header}>
          <PlayerBadge p={match.you} score={scores.you} align="left" />
          <View style={styles.qPill}><AppText weight="extrabold" size={11} color={palette.ink}>{q ? `${q.index + 1}/${q.total}` : '…'}</AppText></View>
          <PlayerBadge p={match.opponent} score={scores.opponent} align="right" />
        </View>
        <View style={styles.timerTrack}><View style={[styles.timerFill, { width: `${fraction * 100}%`, backgroundColor: fraction < 0.25 ? palette.red : palette.amber }]} /></View>
        {q && (
          <ScrollView contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 + insets.bottom, maxWidth: 680, width: '100%', alignSelf: 'center' }}>
            <View style={styles.qCard}>
              <View style={styles.qTag}><AppText weight="extrabold" size={11} color="#FFFFFF">{t('duels.question', { n: q.index + 1 })}</AppText></View>
              <AppText weight="bold" size={17} style={{ lineHeight: 26 }}>{formatMath(L(q.textEn, q.textHi))}</AppText>
              {q.imageUrl && <Image source={{ uri: q.imageUrl }} style={{ width: '100%', height: 180, marginTop: 10, borderRadius: 12 }} resizeMode="contain" />}
              <View style={{ gap: 10, marginTop: 18 }}>
                {q.options.map((o, i) => {
                  const isPicked = picked === o.label;
                  const isCorrect = reveal?.correctLabels.includes(o.label);
                  const oppPicked = reveal?.opponentLabels.includes(o.label);
                  const bg = reveal ? (isCorrect ? '#DCFCE7' : isPicked ? '#FEE2E2' : '#F9FAFB') : isPicked ? '#FFFBEB' : '#F9FAFB';
                  const border = reveal ? (isCorrect ? palette.green : isPicked ? palette.red : '#EEF0F3') : isPicked ? palette.amber : '#EEF0F3';
                  return (
                    <Pressable key={o.label} onPress={() => answer(o.label)} disabled={!!picked || !!reveal} style={[styles.option, { backgroundColor: bg, borderColor: border }]} accessibilityRole="radio" accessibilityState={{ selected: isPicked }}>
                      <View style={[styles.letter, isPicked && { backgroundColor: palette.amber }]}><AppText weight="extrabold" size={12} color={isPicked ? '#FFFFFF' : '#6B7280'}>{LETTERS[i]}</AppText></View>
                      <AppText weight="semibold" size={15} style={{ flex: 1 }}>{formatMath(L(o.textEn, o.textHi))}</AppText>
                      {oppPicked && <View style={[styles.oppDot, { borderColor: match.opponent.color }]} />}
                    </Pressable>
                  );
                })}
              </View>
            </View>
            {reveal ? (
              <View style={styles.revealRow}>
                <AppText weight="extrabold" size={16} color={reveal.yourPoints > 0 ? palette.green : 'rgba(255,255,255,0.6)'}>{t('results.you')} {t('duels.points', { n: reveal.yourPoints })}</AppText>
                <AppText weight="extrabold" size={16} color={reveal.opponentPoints > 0 ? '#F472B6' : 'rgba(255,255,255,0.6)'}>{match.opponent.name.split(' ')[0]} {t('duels.points', { n: reveal.opponentPoints })}</AppText>
              </View>
            ) : (
              <AppText size={13} theme={arena} muted style={{ textAlign: 'center' }}>
                {picked ? t('duels.waitingOpponent') : oppAnswered ? t('duels.opponentAnswered') : `${Math.ceil(remainingMs / 1000)}s`}
              </AppText>
            )}
          </ScrollView>
        )}
      </Screen>
    );
  }

  if (phase === 'finished' && finished && match) {
    const won = finished.outcome === 'WIN';
    const title = won ? t('duels.youWon') : finished.outcome === 'DRAW' ? t('duels.itsDraw') : t('duels.youLost');
    const delta = finished.ratingAfter - finished.ratingBefore;
    const canRematch = new Date(finished.rematchAvailableUntil).getTime() > now && rematchState !== 'declined';
    return (
      <Screen theme={arena} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={{ padding: 24, gap: 20, alignItems: 'center', flexGrow: 1 }}>
          <Pressable onPress={() => router.back()} style={{ alignSelf: 'flex-start' }} accessibilityLabel={t('common.back')}><Ionicons name="close" size={26} color="rgba(255,255,255,0.7)" /></Pressable>
          <AppText weight="extrabold" size={28} theme={arena} style={{ textAlign: 'center', lineHeight: 36 }}>{title}</AppText>
          <View style={styles.vsRow}>
            <View style={{ alignItems: 'center', gap: 6 }}>
              <View style={[styles.glow, won && { shadowColor: palette.amber, shadowOpacity: 0.8 }]}><Avatar name={match.you.name} size={won ? 110 : 84} ring={0} /></View>
              <AppText weight="bold" theme={arena}>{t('results.you')}</AppText>
              <AppText weight="extrabold" size={24} color={palette.amber}>{finished.scores.you}</AppText>
            </View>
            <View style={{ alignItems: 'center', gap: 6 }}>
              <Avatar name={finished.opponent.name} size={!won && finished.outcome !== 'DRAW' ? 110 : 84} ring={1} />
              <AppText weight="bold" theme={arena}>{finished.opponent.name}</AppText>
              <AppText weight="extrabold" size={24} color="#F472B6">{finished.scores.opponent}</AppText>
            </View>
          </View>
          <View style={styles.ratingCard}>
            <AppText size={12} color="rgba(255,255,255,0.6)">{t('duels.newRating')}</AppText>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
              <AppText weight="extrabold" size={40} color="#FFFFFF">{ratingShown || finished.ratingBefore}</AppText>
              {delta !== 0 && <AppText weight="extrabold" size={18} color={delta > 0 ? palette.green : palette.red}>{delta > 0 ? '+' : ''}{delta}</AppText>}
            </View>
            {finished.xpEarned > 0 && <View style={styles.xp}><Ionicons name="flash" size={12} color={palette.ink} /><AppText weight="extrabold" size={11}>{t('result.xpEarned', { xp: finished.xpEarned })}</AppText></View>}
          </View>
          {params.paid && (
            <View style={styles.ratingCard}>
              <AppText weight="extrabold" size={18} color={won ? palette.green : '#FFFFFF'} style={{ textAlign: 'center' }}>
                {won ? t('coinDuels.won', { coins: params.prize ?? '' }) : finished.outcome === 'DRAW' ? t('coinDuels.drew') : t('coinDuels.lost', { coins: params.entry ?? '' })}
              </AppText>
              <AppText size={11} color="rgba(255,255,255,0.6)" style={{ textAlign: 'center' }}>{t('coinDuels.rules')}</AppText>
            </View>
          )}
          {rematchState === 'offered' ? (
            <View style={styles.offer}>
              <AppText weight="bold" size={15} theme={arena}>{t('duels.rematchOffer', { name: offerFrom })}</AppText>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button title={t('duels.accept')} size="md" onPress={() => { setRematchState('waiting'); duelSocket().emit('rematch:request', { duelId: finished.duelId }); }} style={{ flex: 1 }} />
                <Button title={t('duels.decline')} size="md" variant="light" onPress={() => { setRematchState('declined'); duelSocket().emit('rematch:decline', { duelId: finished.duelId }); }} style={{ flex: 1 }} />
              </View>
            </View>
          ) : canRematch ? (
            <Button
              title={rematchState === 'waiting' ? t('duels.rematchWaiting', { name: finished.opponent.name.split(' ')[0] }) : t('duels.rematchWith', { name: finished.opponent.name.split(' ')[0] })}
              icon="refresh"
              variant="light"
              loading={rematchState === 'waiting'}
              onPress={() => { setRematchState('waiting'); duelSocket().emit('rematch:request', { duelId: finished.duelId }); }}
              style={{ alignSelf: 'stretch' }}
            />
          ) : null}
          <Button title={t('duels.backToArena')} onPress={() => router.back()} style={{ alignSelf: 'stretch' }} />
        </ScrollView>
      </Screen>
    );
  }

  return <Screen theme={arena}><View style={styles.center}><AppText theme={arena}>{t('duels.connecting')}</AppText></View></Screen>;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  orbitWrap: { width: 300, height: 300, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', borderRadius: 999, borderWidth: 1, borderColor: 'rgba(96,165,250,0.25)' },
  codeBox: { paddingHorizontal: 28, paddingVertical: 18, borderRadius: radius.lg, borderWidth: 2, borderColor: palette.amber, borderStyle: 'dashed', backgroundColor: 'rgba(245,158,11,0.08)' },
  vsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', alignSelf: 'stretch', gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  qPill: { backgroundColor: '#FFFFFF', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  timerTrack: { height: 5, marginHorizontal: 16, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  timerFill: { height: '100%', borderRadius: 3 },
  qCard: { backgroundColor: '#FFFFFF', borderRadius: radius.lg, padding: 18, paddingTop: 26 },
  qTag: { position: 'absolute', top: -12, alignSelf: 'center', backgroundColor: '#1E3A8A', paddingHorizontal: 14, paddingVertical: 4, borderRadius: 999 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: radius.md, borderWidth: 1.5 },
  letter: { width: 30, height: 30, borderRadius: 9, backgroundColor: '#EEF0F3', alignItems: 'center', justifyContent: 'center' },
  oppDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 3 },
  revealRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 6 },
  glow: { shadowColor: '#000', shadowRadius: 30, shadowOpacity: 0.3, shadowOffset: { width: 0, height: 0 }, borderRadius: 999 },
  ratingCard: { alignSelf: 'stretch', alignItems: 'center', gap: 6, padding: 18, borderRadius: radius.lg, backgroundColor: '#16244D' },
  xp: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: palette.amber, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  offer: { alignSelf: 'stretch', gap: 12, padding: 16, borderRadius: radius.lg, backgroundColor: 'rgba(245,158,11,0.12)' },
});
