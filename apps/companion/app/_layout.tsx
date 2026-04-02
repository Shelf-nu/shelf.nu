import { useEffect, useState } from "react";
import { Slot, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { OrgProvider } from "@/lib/org-context";
import { ThemeProvider, useTheme } from "@/lib/theme-context";
import { OfflineBanner } from "@/components/offline-banner";
import AnimatedSplash from "@/components/animated-splash";
import { useDeepLinkHandler } from "@/lib/deep-links";
import { useQuickActions } from "@/lib/quick-actions";
import { getStartPage, getStartPageRoute } from "@/lib/start-page";
import { preloadScanSound } from "@/lib/scan-sound";
import Constants from "expo-constants";

// Keep the native splash visible until our animated splash is mounted.
SplashScreen.preventAutoHideAsync().catch(() => {});

// ── Startup diagnostic (visible in Metro terminal) ──────────────────
if (__DEV__) {
  console.log(
    `\n[Shelf] JS executing on ${Platform.OS} | SDK ${Constants.expoConfig?.sdkVersion} | RN ${Platform.constants?.reactNativeVersion?.major}.${Platform.constants?.reactNativeVersion?.minor}.${Platform.constants?.reactNativeVersion?.patch}\n`
  );
}

// Pre-load scan sound so first scan is instant (no init delay)
preloadScanSound();

function RootLayoutNav() {
  const { session, isLoading } = useAuth();
  const { isDark } = useTheme();
  const segments = useSegments();
  const router = useRouter();

  const [splashComplete, setSplashComplete] = useState(false);
  const [startPageRoute, setStartPageRoute] = useState("/(tabs)/assets");

  // Load the user's preferred start page from AsyncStorage on mount.
  // Runs in parallel with auth resolution — resolves in ~5ms, well before
  // the splash animation finishes (~1300ms).
  useEffect(() => {
    getStartPage().then((page) => {
      setStartPageRoute(getStartPageRoute(page));
    });
  }, []);

  // Handle incoming deep links (shelf:// and universal links)
  useDeepLinkHandler();

  // Register 3D Touch / long-press quick actions (home screen shortcuts)
  useQuickActions();

  // Redirect after splash finishes and auth state is known.
  useEffect(() => {
    if (isLoading || !splashComplete) return;

    const inAuthGroup = segments[0] === "(auth)";

    if (!session && !inAuthGroup) {
      router.replace("/(auth)/login");
    } else if (session && inAuthGroup) {
      router.replace(startPageRoute as any);
    }
  }, [session, isLoading, segments, splashComplete, startPageRoute]);

  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      <OfflineBanner />
      <Slot />
      {!splashComplete && (
        <AnimatedSplash
          isReady={!isLoading}
          onComplete={() => setSplashComplete(true)}
        />
      )}
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <OrgProvider>
            <RootLayoutNav />
          </OrgProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
