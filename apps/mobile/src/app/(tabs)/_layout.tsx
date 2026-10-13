import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { ColorValue } from 'react-native';
import { useFont } from '../../components/ui';
import { useSession } from '../../lib/session';
import { palette } from '../../theme/tokens';
import { AnimatedTabBar } from '../../components/AnimatedTabBar';

type IconName = keyof typeof Ionicons.glyphMap;

const icon =
  (name: IconName, active: IconName) =>
  ({ color, focused }: { color: ColorValue; focused: boolean }) => <Ionicons name={focused ? active : name} size={22} color={color as string} />;

export default function TabsLayout() {
  const { t } = useTranslation();
  const { user, config } = useSession();
  const font = useFont();
  if (!user) return <Redirect href="/intro" />;
  if (!user.onboarded) return <Redirect href="/onboarding" />;
  const flags = config?.['features.flags'];

  return (
    <Tabs
      tabBar={(props) => <AnimatedTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.amber,
        tabBarInactiveTintColor: '#9CA3AF',
        tabBarLabelStyle: { fontFamily: font('bold'), fontSize: 11 },
        tabBarStyle: { borderTopColor: '#F1F2F4', height: 64, paddingTop: 6 },
      }}
    >
      <Tabs.Screen name="home" options={{ title: t('tabs.home'), tabBarIcon: icon('home-outline', 'home') }} />
      <Tabs.Screen
        name="arena"
        options={{
          title: t('tabs.arena'),
          tabBarIcon: icon('trophy-outline', 'trophy'),
          href: flags?.tournaments === false && flags?.duels === false ? null : undefined,
        }}
      />
      <Tabs.Screen name="tests" options={{ title: t('tabs.myTests'), tabBarIcon: icon('document-text-outline', 'document-text') }} />
      <Tabs.Screen name="store" options={{ title: t('tabs.store'), tabBarIcon: icon('bag-handle-outline', 'bag-handle'), href: flags?.store === false ? null : undefined }} />
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile'), tabBarIcon: icon('person-outline', 'person') }} />
    </Tabs>
  );
}
