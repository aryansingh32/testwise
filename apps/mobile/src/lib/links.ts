import { router } from 'expo-router';
import { Linking } from 'react-native';

/** Open a link from server content: in-app paths (e.g. /tournament/slug) or web URLs. */
export function openLink(link: string | null | undefined) {
  if (!link) return;
  if (link.startsWith('/')) router.push(link as never);
  else if (/^https?:\/\//.test(link)) void Linking.openURL(link);
}
