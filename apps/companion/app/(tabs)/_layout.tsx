import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import NoWorkspaceScreen from "@/components/no-workspace-screen";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import { useOrg } from "@/lib/org-context";
import { fontSize } from "@/lib/constants";

export default function TabLayout() {
  const { colors } = useTheme();
  const { session } = useAuth();
  const { organizations, isLoading, error } = useOrg();

  // A signed-in user with no workspace has nothing to put in any tab: every
  // screen derives its content from `currentOrg`, which stays null, so each
  // would hold its own loading state forever rather than say why. Answer once,
  // here, instead of teaching six screens the same empty case.
  //
  // Gated on `error` too — a failed `/me` also yields an empty list, and
  // telling someone they have no workspace when the request merely failed
  // sends them to their IT administrator over a dropped connection. The tabs
  // render in that case and surface their own retry.
  //
  // `session` is part of the test because signing out empties the list here
  // before the root layout's redirect to the login screen runs: without it,
  // leaving the app flashes "no workspace assigned" on the way out.
  if (session && !isLoading && !error && organizations.length === 0) {
    return <NoWorkspaceScreen />;
  }

  return (
    <Tabs
      screenOptions={{
        lazy: true,
        // freezeOnBlur is deliberately OFF: react-freeze's Suspender can
        // wedge into an infinite suspense throw/ping/retry loop after a
        // cross-tab navigate (scanner → booking detail via Alert OK),
        // pegging the JS thread at ~125% CPU and starving every network
        // callback. Root-caused live via Hermes debugger: the suspended
        // fiber chain was Suspender < Freeze < DelayedFreeze < Screen
        // (react-native-screens 4.16 + RN 0.81 new arch).
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedLight,
        tabBarStyle: {
          borderTopColor: colors.border,
          backgroundColor: colors.white,
        },
        tabBarLabelStyle: {
          fontSize: fontSize.xs,
          fontWeight: "500",
        },
        headerStyle: {
          backgroundColor: colors.white,
        },
        headerTitleStyle: {
          fontWeight: "600",
          fontSize: fontSize.xl,
          color: colors.foreground,
        },
        headerShadowVisible: false,
        headerTintColor: colors.foreground,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          tabBarAccessibilityLabel: "Home",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="assets"
        options={{
          title: "Assets",
          headerShown: false,
          tabBarAccessibilityLabel: "Assets",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cube-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="scanner"
        options={{
          title: "Scan",
          tabBarAccessibilityLabel: "Scan",
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="scan" size={size + 2} color={color} />
          ),
          tabBarLabelStyle: {
            fontSize: fontSize.xs,
            fontWeight: "600",
          },
        }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          title: "Bookings",
          headerShown: false,
          tabBarAccessibilityLabel: "Bookings",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="audits"
        options={{
          href: null,
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="custody"
        options={{
          href: null,
          title: "Custody",
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarAccessibilityLabel: "Settings",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
