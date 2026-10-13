import { Ionicons } from '@expo/vector-icons';
import type { ExamDto, SeriesCardDto } from '@testwise/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SeriesCard } from '../../components/SeriesCard';
import { AppText, Chip, ErrorState, Loading, Screen, StateView, useFont } from '../../components/ui';
import { api } from '../../lib/api';
import { useLocalized } from '../../lib/format';
import { palette, radius } from '../../theme/tokens';

export default function Store() {
  const { t } = useTranslation();
  const L = useLocalized();
  const font = useFont();
  const [examId, setExamId] = useState<string | undefined>();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const exams = useQuery({ queryKey: ['catalog-exams'], queryFn: () => api<ExamDto[]>('/v1/catalog/exams', { auth: false }) });
  const params = new URLSearchParams({ ...(examId && { examId }), ...(search && { q: search }) }).toString();
  const list = useQuery({ queryKey: ['store', params], queryFn: () => api<SeriesCardDto[]>(`/v1/store/series?${params}`) });

  return (
    <Screen>
      <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
        <AppText weight="extrabold" size={28}>{t('store.title')}</AppText>
        <AppText size={13} muted>{t('store.subtitle')}</AppText>
        <View style={styles.search}>
          <Ionicons name="search" size={18} color="#9CA3AF" />
          <TextInput
            value={q}
            onChangeText={setQ}
            onSubmitEditing={() => setSearch(q.trim())}
            placeholder={t('store.search')}
            placeholderTextColor="#9CA3AF"
            returnKeyType="search"
            style={{ flex: 1, fontFamily: font('medium'), fontSize: 14, color: palette.ink, paddingVertical: 12 }}
          />
          {q ? <Pressable onPress={() => { setQ(''); setSearch(''); }} hitSlop={8}><Ionicons name="close-circle" size={18} color="#9CA3AF" /></Pressable> : null}
        </View>
      </View>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 12, gap: 8 }}>
          <Chip label={t('store.all')} active={!examId} onPress={() => setExamId(undefined)} />
          {exams.data?.map((e) => <Chip key={e.id} label={L(e.nameEn, e.nameHi) ?? e.nameEn} active={examId === e.id} onPress={() => setExamId(examId === e.id ? undefined : e.id)} />)}
        </ScrollView>
      </View>
      {list.isLoading ? (
        <Loading />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : (
        <FlatList
          data={list.data}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ padding: 20, paddingTop: 4, gap: 16, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={list.refetch} tintColor={palette.amber} />}
          renderItem={({ item }) => <SeriesCard s={item} />}
          ListEmptyComponent={<StateView icon="bag-handle-outline" title={t('store.empty')} />}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F3F4F6', borderRadius: radius.md, paddingHorizontal: 14, marginTop: 14 },
});
