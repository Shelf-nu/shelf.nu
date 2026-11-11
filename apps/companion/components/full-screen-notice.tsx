/**
 * The layout for a full-screen notice that takes a tab's place: an icon, a
 * title, a few lines of text and up to a few actions, centred in the form
 * column. Shared by the screens that answer "you can't use this right now"
 * so they keep the same spacing, width and buttons.
 *
 * @see components/no-workspace-screen.tsx
 * @see components/inactive-workspace-screen.tsx
 */
import type { ComponentProps, ReactNode } from "react";
import {
  ActivityIndicator,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { borderRadius, fontSize, spacing } from "@/lib/constants";
import { createStyles } from "@/lib/create-styles";
import { FORM_MAX_WIDTH } from "@/lib/content-column";
import { useTheme } from "@/lib/theme-context";

/**
 * @param props.icon - Ionicons name shown above the title.
 * @param props.title - The heading, read as a header by screen readers.
 * @param props.children - The text and actions under the title.
 * @param props.style - Outer container style, such as a top inset.
 */
export function FullScreenNotice({
  icon,
  title,
  children,
  style,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  title: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={[styles.container, style]}>
      <View style={styles.content}>
        <Ionicons
          name={icon}
          size={48}
          color={colors.mutedLight}
          accessibilityElementsHidden
        />
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {children}
      </View>
    </View>
  );
}

/**
 * Text of a {@link FullScreenNotice}: `body` for the main line, `emphasis`
 * for a name or other line that stands out, `hint` for the quieter one.
 */
export function NoticeText({
  children,
  variant = "body",
}: {
  children: ReactNode;
  variant?: "body" | "hint" | "emphasis";
}) {
  const styles = useStyles();
  return <Text style={styles[variant]}>{children}</Text>;
}

/**
 * A full-width action of a {@link FullScreenNotice}.
 *
 * @param props.label - The button text.
 * @param props.accessibilityLabel - What a screen reader says for it.
 * @param props.onPress - The action.
 * @param props.variant - `primary` (filled) or `secondary` (outlined).
 * @param props.busy - Shows a spinner and disables the button.
 */
export function NoticeButton({
  label,
  accessibilityLabel,
  onPress,
  variant = "primary",
  busy = false,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
  busy?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const primary = variant === "primary";
  return (
    <TouchableOpacity
      style={[
        primary ? styles.button : styles.secondaryButton,
        busy && styles.buttonDisabled,
      ]}
      onPress={onPress}
      disabled={busy}
      activeOpacity={0.7}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: busy, busy }}
    >
      {busy ? (
        <ActivityIndicator
          color={primary ? colors.primaryForeground : colors.foreground}
        />
      ) : (
        <Text style={primary ? styles.buttonText : styles.secondaryButtonText}>
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const useStyles = createStyles((colors, shadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
    // Renders in place of a tab (or the whole tab navigator), so it keeps the
    // sign-in screen's width on a tablet itself.
    width: "100%",
    maxWidth: FORM_MAX_WIDTH,
    alignSelf: "center",
  },
  title: {
    fontSize: fontSize.xxxl,
    fontWeight: "600",
    color: colors.foreground,
    textAlign: "center",
  },
  body: {
    fontSize: fontSize.md,
    color: colors.foregroundSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
  emphasis: {
    fontSize: fontSize.md,
    fontWeight: "500",
    color: colors.foreground,
    textAlign: "center",
  },
  hint: {
    fontSize: fontSize.sm,
    color: colors.mutedLight,
    textAlign: "center",
    lineHeight: 20,
  },
  button: {
    alignSelf: "stretch",
    backgroundColor: colors.primary,
    borderRadius: borderRadius.sm,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: spacing.sm,
    ...shadows.sm,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.primaryForeground,
  },
  secondaryButton: {
    alignSelf: "stretch",
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryButtonText: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.foreground,
  },
}));
