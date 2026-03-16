import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth-context";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";

export default function ForgotPasswordScreen() {
  const { resetPassword } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);

  const handleSubmit = async () => {
    Keyboard.dismiss();
    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Please enter your email address.");
      return;
    }

    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Please enter a valid email address.");
      return;
    }

    setIsSubmitting(true);
    const { error: resetError } = await resetPassword(trimmedEmail);
    setIsSubmitting(false);

    if (resetError) {
      setError(resetError);
    } else {
      setIsSent(true);
    }
  };

  if (isSent) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.inner}>
          <View style={styles.successContainer}>
            <View style={styles.successIcon}>
              <Ionicons name="mail-outline" size={40} color={colors.success} />
            </View>
            <Text style={styles.successTitle}>Check your email</Text>
            <Text style={styles.successText}>
              We've sent a password reset link to{"\n"}
              <Text style={styles.emailHighlight}>{email.trim()}</Text>
            </Text>
            <Text style={styles.successHint}>
              If you don't see the email, check your spam folder.
            </Text>
            <TouchableOpacity
              testID="back-to-signin-button"
              style={styles.button}
              onPress={() => router.back()}
              activeOpacity={0.8}
              accessibilityLabel="Return to sign in"
              accessibilityRole="button"
            >
              <Text style={styles.buttonText}>Back to Sign In</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <Pressable onPress={Keyboard.dismiss} accessible={false}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={[styles.container, { paddingTop: insets.top }]}
      >
        <View accessible={false} style={styles.inner}>
          {/* Back button */}
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.7}
            accessibilityLabel="Go back to sign in"
            accessibilityRole="button"
          >
            <Ionicons name="arrow-back" size={24} color={colors.foreground} />
          </TouchableOpacity>

          <View style={styles.header}>
            <Text style={styles.title}>Forgot password?</Text>
            <Text style={styles.subtitle}>
              Enter the email associated with your Shelf account and we'll send
              you a link to reset your password.
            </Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              testID="forgot-email-input"
              style={[styles.input, error ? styles.inputError : null]}
              value={email}
              onChangeText={(t) => {
                setEmail(t);
                setError(null);
              }}
              placeholder="you@example.com"
              placeholderTextColor={colors.placeholderText}
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="go"
              onSubmitEditing={handleSubmit}
              editable={!isSubmitting}
              autoFocus
              accessibilityLabel="Email address"
            />

            {error && (
              <Text
                style={styles.errorText}
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
              >
                {error}
              </Text>
            )}

            <TouchableOpacity
              testID="send-reset-button"
              style={[styles.button, isSubmitting && styles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={isSubmitting}
              activeOpacity={0.8}
              accessibilityLabel="Send reset link"
              accessibilityRole="button"
            >
              {isSubmitting ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={styles.buttonText}>Send Reset Link</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Pressable>
  );
}

const useStyles = createStyles((colors, shadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  inner: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.xxl,
  },
  backButton: {
    position: "absolute",
    top: spacing.lg,
    left: 0,
    padding: spacing.sm,
  },
  header: {
    marginBottom: spacing.xxxl,
  },
  title: {
    fontSize: fontSize.xxxl,
    fontWeight: "800",
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: fontSize.lg,
    color: colors.muted,
    lineHeight: 22,
  },
  form: {
    gap: spacing.xs,
  },
  label: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.gray700,
    marginBottom: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: fontSize.lg,
    color: colors.foreground,
    backgroundColor: colors.white,
    ...shadows.sm,
  },
  inputError: {
    borderColor: colors.error,
  },
  errorText: {
    color: colors.error,
    fontSize: fontSize.sm,
    marginTop: spacing.sm,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: spacing.xxl,
    ...shadows.sm,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: colors.primaryForeground,
    fontSize: fontSize.lg,
    fontWeight: "600",
  },

  // Success state
  successContainer: {
    alignItems: "center",
    gap: spacing.md,
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.successBg,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  successTitle: {
    fontSize: fontSize.xxxl,
    fontWeight: "800",
    color: colors.foreground,
  },
  successText: {
    fontSize: fontSize.lg,
    color: colors.muted,
    textAlign: "center",
    lineHeight: 22,
  },
  emailHighlight: {
    fontWeight: "600",
    color: colors.foreground,
  },
  successHint: {
    fontSize: fontSize.sm,
    color: colors.mutedLight,
    textAlign: "center",
    marginTop: spacing.sm,
  },
}));
