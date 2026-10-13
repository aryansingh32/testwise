import { Redirect } from 'expo-router';
import { useSession } from '../lib/session';

export default function Index() {
  const { user } = useSession();
  if (!user) return <Redirect href="/intro" />;
  if (!user.onboarded) return <Redirect href="/onboarding" />;
  return <Redirect href="/home" />;
}
