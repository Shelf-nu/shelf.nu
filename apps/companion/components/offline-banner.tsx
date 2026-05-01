import { useEffect, useState, useRef } from "react";
import { Text, Animated, Platform } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fontSize, spacing } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { useReducedMotion } from "@/lib/a11y";

const useStyles = createStyles((colors) => ({
  banner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.error,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  bannerText: {
    color: colors.primaryForeground,
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
}));

/**
 * Monitors network connectivity and shows a banner when offline.
 * Uses @react-native-community/netinfo for reliable detection.
 *
 * Renders as an absolutely-positioned overlay so it never affects
 * the layout of content below. Slides in/out via translateY.
 */
/** Height of the banner content (padding + icon/text) */
const BANNER_CONTENT_HEIGHT = spacing.sm * 2 + 20;

export function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const [isOffline, setIsOffline] = useState(false);
  const totalHeight = BANNER_CONTENT_HEIGHT + insets.top;
  const translateY = useRef(new Animated.Value(-totalHeight)).current;
  const { colors } = useTheme();
  const styles = useStyles();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    // NetInfo doesn't reliably detect connectivity on web — skip monitoring
    if (Platform.OS === "web") return;

    const unsubscribe = NetInfo.addEventListener((state) => {
      const offline = !(
        state.isConnected && state.isInternetReachable !== false
      );
      setIsOffline(offline);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const targetValue = isOffline ? 0 : -totalHeight;

    if (reduceMotion) {
      translateY.setValue(targetValue);
      return;
    }

    Animated.timing(translateY, {
      toValue: targetValue,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [isOffline, translateY, totalHeight, reduceMotion]);

  return (
    <Animated.View
      style={[
        styles.banner,
        {
          height: totalHeight,
          paddingTop: insets.top,
          transform: [{ translateY }],
          pointerEvents: isOffline ? "auto" : "none",
        },
      ]}
      accessibilityLiveRegion="polite"
      accessibilityLabel={isOffline ? "No internet connection" : undefined}
    >
      <Ionicons
        name="cloud-offline-outline"
        size={16}
        color={colors.primaryForeground}
      />
      <Text style={styles.bannerText}>No internet connection</Text>
    </Animated.View>
  );
}
