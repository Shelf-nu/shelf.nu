import { useEffect, useRef, useState } from "react";
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
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth-context";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import ShelfIcon from "@/components/brand/shelf-icon";
import ShelfWordmark from "@/components/brand/shelf-wordmark";

export default function LoginScreen() {
  const { signIn } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── iOS credential autofill detection ──────────────────────────────
  // Face ID autofill sets each field exactly once (count=1).
  // Manual typing fires onChangeText per keystroke (count >> 1).
  // When both fields fill with count=1, auto-submit so the user
  // doesn't have to scroll down and tap "Sign In" after Face ID.
  const changeCountRef = useRef({ email: 0, password: 0 });
  const autoSubmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!email.trim() || !password || isSubmitting) return;

    const { email: ec, password: pc } = changeCountRef.current;
    if (ec === 1 && pc === 1) {
      autoSubmitTimerRef.current = setTimeout(handleLogin, 500);
    }

    return () => {
      if (autoSubmitTimerRef.current) clearTimeout(autoSubmitTimerRef.current);
    };
  }, [email, password, isSubmitting]);

  const handleLogin = async () => {
    Keyboard.dismiss();
    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("Please enter both email and password.");
      return;
    }

    setIsSubmitting(true);
    const { error: signInError } = await signIn(trimmedEmail, password);
    setIsSubmitting(false);

    if (signInError) {
      setError(signInError);
    }
  };

  return (
    <Pressable
      style={{ flex: 1 }}
      onPress={Keyboard.dismiss}
      accessible={false}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.container}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          {/* ── Brand Section ─────────────────────────────────────── */}
          <View style={styles.brand}>
            <ShelfIcon size={72} />
            <View style={styles.wordmarkWrap}>
              <ShelfWordmark width={100} color={colors.foreground} />
            </View>
          </View>

          {/* ── Welcome Text ──────────────────────────────────────── */}
          <View style={styles.welcomeSection}>
            <Text style={styles.welcomeTitle}>Welcome back</Text>
            <Text style={styles.welcomeSubtitle}>Sign in to your account</Text>
          </View>

          {/* ── Form ──────────────────────────────────────────────── */}
          <View style={styles.form}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              testID="email-input"
              style={[styles.input, error ? styles.inputError : null]}
              value={email}
              onChangeText={(t) => {
                setEmail(t);
                setError(null);
                changeCountRef.current.email++;
              }}
              placeholder="you@example.com"
              placeholderTextColor={colors.placeholderText}
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              blurOnSubmit={false}
              editable={!isSubmitting}
              accessibilityLabel="Email"
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              testID="password-input"
              ref={passwordRef}
              style={[styles.input, error ? styles.inputError : null]}
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                setError(null);
                changeCountRef.current.password++;
              }}
              placeholder="Your password"
              placeholderTextColor={colors.placeholderText}
              secureTextEntry
              autoComplete="password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={handleLogin}
              editable={!isSubmitting}
              accessibilityLabel="Password"
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
              testID="forgot-password-link"
              style={styles.forgotLink}
              onPress={() => router.push("/(auth)/forgot-password")}
              activeOpacity={0.7}
              accessibilityLabel="Forgot your password? Reset it"
              accessibilityRole="link"
            >
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>

            <TouchableOpacity
              testID="sign-in-button"
              style={[styles.button, isSubmitting && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={isSubmitting}
              activeOpacity={0.8}
              accessibilityLabel={
                isSubmitting ? "Signing in" : "Sign in to your account"
              }
              accessibilityRole="button"
            >
              {isSubmitting ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={styles.buttonText}>Sign In</Text>
              )}
            </TouchableOpacity>
          </View>

          <Text style={styles.footer}>
            Use the same credentials as your Shelf web account.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Pressable>
  );
}

const useStyles = createStyles((colors, shadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.xxl,
  },
  brand: {
    alignItems: "center",
    marginBottom: spacing.xxxl,
  },
  wordmarkWrap: {
    marginTop: spacing.md,
  },
  welcomeSection: {
    alignItems: "center",
    marginBottom: spacing.xxxl,
  },
  welcomeTitle: {
    fontSize: fontSize.xxxl,
    fontWeight: "700",
    color: colors.foreground,
  },
  welcomeSubtitle: {
    fontSize: fontSize.md,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  form: {
    gap: spacing.xs,
  },
  label: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.gray700,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
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
  forgotLink: {
    alignSelf: "flex-end",
    marginTop: spacing.sm,
  },
  forgotText: {
    fontSize: fontSize.sm,
    color: colors.buttonGhostText,
    fontWeight: "500",
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.xl,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: spacing.xl,
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
  footer: {
    textAlign: "center",
    color: colors.mutedLight,
    fontSize: fontSize.sm,
    marginTop: spacing.xxxl,
  },
}));
