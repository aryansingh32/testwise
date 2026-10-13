import type { QuestionReview } from '@testwise/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FlatList } from 'react-native';
import { Header } from '../components/Header';
import { ReviewItem } from '../components/ReviewItem';
import { ErrorState, Loading, Screen, StateView } from '../components/ui';
import { api } from '../lib/api';

export default function Mistakes() {
  const { t } = useTranslation();
  const { data, error, isLoading, refetch } = useQuery({ queryKey: ['mistakes'], queryFn: () => api<(QuestionReview & { attemptId: string })[]>('/v1/me/mistakes') });
  return (
    <Screen>
      <Header title={t('analysis.mistakes')} fallback="/analysis" />
      {isLoading ? <Loading /> : error ? <ErrorState error={error} onRetry={refetch} /> : (
        <FlatList
          data={data}
          keyExtractor={(q) => q.id}
          contentContainerStyle={{ padding: 20, gap: 12, flexGrow: 1, maxWidth: 760, width: '100%', alignSelf: 'center' }}
          renderItem={({ item, index }) => <ReviewItem q={item} n={index + 1} />}
          ListEmptyComponent={<StateView icon="happy-outline" title={t('analysis.mistakesEmpty')} />}
        />
      )}
    </Screen>
  );
}
