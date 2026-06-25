import { Stack } from "expo-router";
import { useTheme } from "@/lib/theme-context";
import { fontSize } from "@/lib/constants";

/**
 * Anchor this stack at its list screen. When navigated into directly from
 * another tab / deep link (with `withAnchor`), expo-router places `index`
 * beneath the target screen so the user always has a back path to the list.
 */
export const unstable_settings = { initialRouteName: "index" };

export default function AssetsLayout() {
  const { colors } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.white },
        headerTitleStyle: {
          fontWeight: "600",
          fontSize: fontSize.xl,
          color: colors.foreground,
        },
        headerShadowVisible: false,
        headerTintColor: colors.foreground,
        headerBackButtonDisplayMode: "minimal",
        gestureEnabled: true,
      }}
    >
      <Stack.Screen name="index" options={{ title: "Assets" }} />
      <Stack.Screen name="[id]" options={{ title: "Asset Details" }} />
      <Stack.Screen name="new" options={{ title: "New Asset" }} />
      <Stack.Screen name="edit" options={{ title: "Edit Asset" }} />
      {/* Kits live in this stack so the segmented Assets|Kits switcher swaps
          lists in place and the tab bar keeps Assets active. */}
      <Stack.Screen name="kits/index" options={{ title: "Kits" }} />
      <Stack.Screen name="kits/[id]" options={{ title: "Kit Details" }} />
    </Stack>
  );
}
