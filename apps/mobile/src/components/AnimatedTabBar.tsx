import type { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from './ui';
import { palette } from '../theme/tokens';

/** Tabs whose page is the dark navy Arena look. The bar follows the page so the two never clash. */
type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const DARK_ROUTES = new Set(['arena']);

const LIGHT = { plate: '#FFFFFF', edge: '#F1F2F4', inactive: '#9CA3AF', pill: 'rgba(245,158,11,0.14)' };
const DARK = { plate: '#0A1230', edge: 'rgba(255,255,255,0.10)', inactive: 'rgba(255,255,255,0.55)', pill: 'rgba(245,158,11,0.20)' };

/**
 * Bottom navigation that adapts to the page behind it and moves with intent. Built from depth layers, animating only
 * transform and opacity (GPU-friendly, native driver):
 *   0 plate (light) and plate (dark) cross-fade as the page theme changes
 *   1 amber glow + indicator pill that slides under the active tab
 *   2 icons that lift and pop when selected, press-scale on touch
 *   3 labels
 *   4 a slow light sweep along the top edge while on the dark Arena
 * Reduced-motion users get the same states without movement. Every tab is a labelled, selectable button.
 */
export function AnimatedTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const routes = state.routes.filter((r) => (descriptors[r.key].options as { href?: string | null }).href !== null);
  const focusedRoute = state.routes[state.index];
  const dark = DARK_ROUTES.has(focusedRoute.name);
  const colors = dark ? DARK : LIGHT;
  const activeSlot = Math.max(0, routes.findIndex((r) => r.key === focusedRoute.key));
  const slotWidth = width / Math.max(1, routes.length);

  const darkness = useRef(new Animated.Value(dark ? 1 : 0)).current;
  const slide = useRef(new Animated.Value(activeSlot)).current;
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const spring = (v: Animated.Value, to: number, cfg: object) => (reduceMotion ? (v.setValue(to), null) : Animated.spring(v, { toValue: to, useNativeDriver: true, ...cfg }).start());
    if (reduceMotion) darkness.setValue(dark ? 1 : 0);
    else Animated.timing(darkness, { toValue: dark ? 1 : 0, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    spring(slide, activeSlot, { stiffness: 220, damping: 20, mass: 0.9 });
  }, [dark, activeSlot, reduceMotion, darkness, slide]);

  // Slow light sweep on the dark plate, only while it is visible and motion is allowed.
  useEffect(() => {
    if (!dark || reduceMotion || width === 0) return;
    sweep.setValue(0);
    const loop = Animated.loop(Animated.timing(sweep, { toValue: 1, duration: 5200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [dark, reduceMotion, width, sweep]);

  const translateX = slide.interpolate({ inputRange: [0, Math.max(1, routes.length - 1)], outputRange: [0, slotWidth * Math.max(1, routes.length - 1)] });
  const sweepX = sweep.interpolate({ inputRange: [0, 1], outputRange: [-width * 0.5, width] });

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {/* depth 0: plates */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: LIGHT.plate, borderTopColor: LIGHT.edge, borderTopWidth: StyleSheet.hairlineWidth }]} />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: darkness, backgroundColor: DARK.plate, borderTopColor: DARK.edge, borderTopWidth: StyleSheet.hairlineWidth }]} />
      {/* depth 4: light sweep */}
      <Animated.View pointerEvents="none" style={[styles.sweepWrap, { opacity: darkness }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Animated.View style={{ width: width * 0.5, height: 1.5, transform: [{ translateX: sweepX }] }}>
          <LinearGradient colors={['transparent', 'rgba(245,158,11,0.9)', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      </Animated.View>

      <View style={styles.row}>
        {/* depth 1: glow + sliding pill */}
        {width > 0 && (
          <Animated.View pointerEvents="none" style={[styles.pill, { width: slotWidth, transform: [{ translateX }] }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <View style={[styles.pillShape, { backgroundColor: colors.pill }]} />
          </Animated.View>
        )}
        {routes.map((route, i) => {
          const { options } = descriptors[route.key];
          const focused = route.key === focusedRoute.key;
          const label = typeof options.tabBarLabel === 'string' ? options.tabBarLabel : options.title ?? route.name;
          return (
            <TabButton
              key={route.key}
              focused={focused}
              reduceMotion={reduceMotion}
              label={label}
              inactiveColor={colors.inactive}
              icon={options.tabBarIcon?.({ focused, color: focused ? palette.amber : colors.inactive, size: 22 })}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
              }}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
              testID={`tab-${route.name}`}
              index={i}
            />
          );
        })}
      </View>
    </View>
  );
}

function TabButton({ focused, reduceMotion, label, inactiveColor, icon, onPress, onLongPress, testID }: { focused: boolean; reduceMotion: boolean; label: string; inactiveColor: string; icon: React.ReactNode; onPress: () => void; onLongPress: () => void; testID: string; index: number }) {
  const lift = useRef(new Animated.Value(focused ? 1 : 0)).current;
  const press = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduceMotion) lift.setValue(focused ? 1 : 0);
    else Animated.spring(lift, { toValue: focused ? 1 : 0, stiffness: 260, damping: 14, mass: 0.7, useNativeDriver: true }).start();
  }, [focused, reduceMotion, lift]);

  const pressTo = (v: number) => {
    if (!reduceMotion) Animated.spring(press, { toValue: v, stiffness: 400, damping: 20, useNativeDriver: true }).start();
  };
  const iconScale = Animated.multiply(lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }), press);
  const iconY = lift.interpolate({ inputRange: [0, 1], outputRange: [0, -3] });
  const labelY = lift.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const glow = lift.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: focused }}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => pressTo(0.9)}
      onPressOut={() => pressTo(1)}
      testID={testID}
      style={styles.tab}
      android_ripple={Platform.OS === 'android' ? { color: 'rgba(245,158,11,0.15)', borderless: true, radius: 34 } : undefined}
    >
      <View style={styles.iconBox}>
        {/* depth 1: soft amber halo behind the selected icon */}
        <Animated.View pointerEvents="none" style={[styles.halo, { opacity: glow, transform: [{ scale: glow }] }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden />
        <Animated.View style={{ transform: [{ translateY: iconY }, { scale: iconScale }] }}>{icon}</Animated.View>
      </View>
      <Animated.View style={{ transform: [{ translateY: labelY }] }}>
        <AppText weight="bold" size={11} color={focused ? palette.amber : inactiveColor} numberOfLines={1}>{label}</AppText>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { paddingTop: 6, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'stretch', height: 56 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  iconBox: { width: 44, height: 28, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(245,158,11,0.22)' },
  pill: { position: 'absolute', top: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  pillShape: { width: '70%', height: '88%', borderRadius: 22 },
  sweepWrap: { position: 'absolute', top: 0, left: 0, right: 0, height: 2, overflow: 'hidden' },
});
