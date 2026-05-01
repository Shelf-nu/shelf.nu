import { Stack } from "expo-router";
import { useTheme } from "@/lib/theme-context";
import { fontSize } from "@/lib/constants";

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
    </Stack>
  );
}
