import { Redirect } from 'expo-router';

/** Deep link target for duel notifications: open the Arena on the Duels tab. */
export default function DuelsIndex() {
  return <Redirect href={{ pathname: '/arena', params: { tab: 'duels' } }} />;
}
