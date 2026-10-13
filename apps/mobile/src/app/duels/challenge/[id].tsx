import { Redirect, useLocalSearchParams } from 'expo-router';

/** Opened from the "friend accepted your challenge" notification: resume hosting that duel. */
export default function ChallengeLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={{ pathname: '/duels/play', params: { host: id } }} />;
}
