import { Stack } from "expo-router";
import { useTheme } from "@/lib/theme-context";
import { fontSize } from "@/lib/constants";

/**
 * Anchor this stack at its list screen so cross-tab / deep-link navigation
 * into an audit always leaves a back path to the audits list.
 */
export const unstable_settings = { initialRouteName: "index" };

export default function AuditsLayout() {
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
      <Stack.Screen name="index" options={{ title: "Audits" }} />
      <Stack.Screen name="[id]" options={{ title: "Audit Details" }} />
      <Stack.Screen
        name="scan"
        options={{ title: "Audit Scanner", headerShown: false }}
      />
      {/* The Assets tab's asset screens, mounted here too so an asset opened
          from an audit row sits on top of the audit and every back path
          returns to it. See lib/asset-routes.ts. */}
      <Stack.Screen name="asset/[id]" options={{ title: "Asset Details" }} />
      <Stack.Screen name="asset/edit" options={{ title: "Edit Asset" }} />
      <Stack.Screen name="kit/[id]" options={{ title: "Kit Details" }} />
    </Stack>
  );
}
