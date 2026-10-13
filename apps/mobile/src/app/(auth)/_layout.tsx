import { Redirect, Stack } from 'expo-router';
import { useSession } from '../../lib/session';

export default function AuthLayout() {
  const { user } = useSession();
  if (user) return <Redirect href={user.onboarded ? '/home' : '/onboarding'} />;
  return <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />;
}
