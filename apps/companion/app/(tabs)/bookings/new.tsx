/**
 * Create-booking screen.
 *
 * Renders the form for creating a new booking (name, description, custodian,
 * start/end date-time, optional tags). On submit the booking is created as a
 * DRAFT and the user is taken to its detail screen, where assets/kits are added
 * via the availability picker / scanner — mirroring the web "create then
 * manage-assets" flow.
 *
 * Validation (future date, working-hours, buffer, max-length, required-tags) is
 * enforced server-side by the shared `BookingFormSchema`; this screen surfaces
 * those messages. Dates are sent as local wire strings (`yyyy-MM-dd'T'HH:mm`)
 * plus the device IANA `timeZone`, since native clients have no client-hint
 * cookie.
 *
 * @see {@link file://../assets/new.tsx} the asset-create screen this mirrors.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { api, type BookingTag, type TeamMember } from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { labelForRequired } from "@/lib/a11y";
import { TeamMemberPicker } from "@/components/team-member-picker";

/** Device IANA time zone (falls back to UTC) — sent so the server resolves the
 * local wire dates correctly without a client-hint cookie. */
function getTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Format a Date as the server's local wire string: `yyyy-MM-dd'T'HH:mm`. */
function toLocalWire(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
}

/** Human-readable date-time for the picker buttons. */
function formatDisplay(d: Date): string {
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function CreateBookingScreen() {
  const router = useRouter();
  const { currentOrg } = useOrg();
  const { colors } = useTheme();
  const styles = useStyles();

  // ── Form state ──────────────────────────────────
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [custodian, setCustodian] = useState<TeamMember | null>(null);
  // Default to a sensible near-future window (tomorrow 9:00–17:00) so the form
  // is one-tap usable; the user can still adjust either picker.
  const [from, setFrom] = useState<Date | null>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  });
  const [to, setTo] = useState<Date | null>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(17, 0, 0, 0);
    return d;
  });
  // Capture the initial default window (refs init once) so a date-only change
  // still counts as an unsaved edit in the discard guard below.
  const initialFromRef = useRef(from?.getTime() ?? null);
  const initialToRef = useRef(to?.getTime() ?? null);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Picker visibility ───────────────────────────
  const [showCustodianPicker, setShowCustodianPicker] = useState(false);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);

  // ── Tags (optional; may be required server-side) ──
  const [tags, setTags] = useState<BookingTag[]>([]);

  useEffect(() => {
    if (!currentOrg) return;
    let active = true;
    api.bookingTags(currentOrg.id).then(({ data }) => {
      if (active && data?.tags) setTags(data.tags);
    });
    return () => {
      active = false;
    };
  }, [currentOrg]);

  // ── Unsaved-changes guard ───────────────────────
  const didSubmitRef = useRef(false);
  const navigation = useNavigation();
  const hasUnsavedChanges =
    name.trim().length > 0 ||
    description.trim().length > 0 ||
    !!custodian ||
    selectedTagIds.size > 0 ||
    (from ? from.getTime() : null) !== initialFromRef.current ||
    (to ? to.getTime() : null) !== initialToRef.current;

  useEffect(() => {
    if (!hasUnsavedChanges || didSubmitRef.current) return;
    const unsubscribe = navigation.addListener("beforeRemove", (e) => {
      if (!hasUnsavedChanges || didSubmitRef.current) return;
      e.preventDefault();
      Alert.alert(
        "Discard booking?",
        "You have unsaved changes. Are you sure you want to leave?",
        [
          { text: "Keep Editing", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => navigation.dispatch(e.data.action),
          },
        ]
      );
    });
    return unsubscribe;
  }, [navigation, hasUnsavedChanges]);

  // ── Date pickers ────────────────────────────────
  const onFromChange = useCallback(
    (event: DateTimePickerEvent, selected: Date | undefined) => {
      if (Platform.OS === "android") setShowFromPicker(false);
      if (event.type === "dismissed") return;
      if (selected) {
        setFrom(selected);
        // Keep `to` after `from`: if it's now invalid, push it to +1 day.
        setTo((prev) =>
          prev && prev <= selected
            ? new Date(selected.getTime() + 24 * 60 * 60 * 1000)
            : prev
        );
        if (Platform.OS === "ios") setShowFromPicker(false);
      }
    },
    []
  );

  const onToChange = useCallback(
    (event: DateTimePickerEvent, selected: Date | undefined) => {
      if (Platform.OS === "android") setShowToPicker(false);
      if (event.type === "dismissed") return;
      if (selected) {
        setTo(selected);
        if (Platform.OS === "ios") setShowToPicker(false);
      }
    },
    []
  );

  const toggleTag = useCallback((id: string) => {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ── Submit ──────────────────────────────────────
  const handleSubmit = async () => {
    if (!currentOrg) return;
    if (name.trim().length < 2) {
      Alert.alert("Validation", "Name must be at least 2 characters.");
      return;
    }
    if (!custodian) {
      Alert.alert("Validation", "Please select a custodian.");
      return;
    }
    if (!from || !to) {
      Alert.alert("Validation", "Please choose start and end date-times.");
      return;
    }
    if (to <= from) {
      Alert.alert("Validation", "End date must be after the start date.");
      return;
    }

    setIsSubmitting(true);
    const { data, error } = await api.createBooking(currentOrg.id, {
      name: name.trim(),
      description: description.trim() || undefined,
      custodianTeamMemberId: custodian.id,
      startDate: toLocalWire(from),
      endDate: toLocalWire(to),
      timeZone: getTimeZone(),
      tags: selectedTagIds.size > 0 ? Array.from(selectedTagIds) : undefined,
    });
    setIsSubmitting(false);

    if (error || !data) {
      Alert.alert("Couldn't create booking", error || "Please try again.");
      return;
    }

    didSubmitRef.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Go to the new DRAFT booking — assets/kits are added there.
    router.replace(`/(tabs)/bookings/${data.booking.id}`);
  };

  const canSubmit =
    name.trim().length >= 2 && !!custodian && !!from && !!to && !isSubmitting;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={100}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Name (required) ──────────────────────── */}
        <View style={styles.field}>
          <Text style={styles.label}>
            Name <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Studio 3 — Friday session"
            placeholderTextColor={colors.placeholderText}
            autoFocus
            returnKeyType="next"
            maxLength={100}
            accessibilityLabel={labelForRequired("Booking name")}
          />
          {name.length > 0 && name.trim().length < 2 && (
            <Text
              style={styles.errorHint}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              Must be at least 2 characters
            </Text>
          )}
        </View>

        {/* ── Description (optional) ───────────────── */}
        <View style={styles.field}>
          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={description}
            onChangeText={setDescription}
            placeholder="Optional notes..."
            placeholderTextColor={colors.placeholderText}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            maxLength={1000}
            accessibilityLabel="Description"
          />
        </View>

        {/* ── Custodian (required) ─────────────────── */}
        <View style={styles.field}>
          <Text style={styles.label}>
            Custodian <Text style={styles.required}>*</Text>
          </Text>
          <TouchableOpacity
            style={styles.pickerButton}
            onPress={() => setShowCustodianPicker(true)}
            accessibilityRole="button"
            accessibilityLabel={
              custodian
                ? `Custodian: ${custodian.name}, tap to change`
                : "Select a custodian"
            }
          >
            {custodian ? (
              <View style={styles.pickerSelected}>
                <Ionicons
                  name="person-outline"
                  size={16}
                  color={colors.iconDefault}
                />
                <Text style={styles.pickerSelectedText}>{custodian.name}</Text>
              </View>
            ) : (
              <Text style={styles.pickerPlaceholder}>
                Select a custodian...
              </Text>
            )}
            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.mutedLight}
            />
          </TouchableOpacity>
        </View>

        {/* ── Start / End date-time (required) ─────── */}
        <View style={styles.field}>
          <Text style={styles.label}>
            Starts <Text style={styles.required}>*</Text>
          </Text>
          <TouchableOpacity
            style={styles.pickerButton}
            onPress={() => {
              setShowFromPicker((o) => !o);
              setShowToPicker(false);
            }}
            accessibilityRole="button"
            accessibilityLabel={
              from
                ? `Starts ${formatDisplay(from)}, tap to change`
                : "Choose start"
            }
          >
            <Text
              style={
                from ? styles.pickerSelectedText : styles.pickerPlaceholder
              }
            >
              {from ? formatDisplay(from) : "Choose start date & time..."}
            </Text>
            <Ionicons
              name="calendar-outline"
              size={18}
              color={colors.mutedLight}
            />
          </TouchableOpacity>
          {showFromPicker && (
            <View
              style={Platform.OS === "ios" ? styles.dateInlineWrap : undefined}
            >
              <DateTimePicker
                value={from ?? new Date()}
                mode="datetime"
                display={Platform.OS === "ios" ? "inline" : "default"}
                onChange={onFromChange}
                accentColor={colors.primary}
              />
            </View>
          )}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>
            Ends <Text style={styles.required}>*</Text>
          </Text>
          <TouchableOpacity
            style={styles.pickerButton}
            onPress={() => {
              setShowToPicker((o) => !o);
              setShowFromPicker(false);
            }}
            accessibilityRole="button"
            accessibilityLabel={
              to ? `Ends ${formatDisplay(to)}, tap to change` : "Choose end"
            }
          >
            <Text
              style={to ? styles.pickerSelectedText : styles.pickerPlaceholder}
            >
              {to ? formatDisplay(to) : "Choose end date & time..."}
            </Text>
            <Ionicons
              name="calendar-outline"
              size={18}
              color={colors.mutedLight}
            />
          </TouchableOpacity>
          {showToPicker && (
            <View
              style={Platform.OS === "ios" ? styles.dateInlineWrap : undefined}
            >
              <DateTimePicker
                value={to ?? from ?? new Date()}
                mode="datetime"
                display={Platform.OS === "ios" ? "inline" : "default"}
                minimumDate={from ?? undefined}
                onChange={onToChange}
                accentColor={colors.primary}
              />
            </View>
          )}
        </View>

        {/* ── Tags (optional) ──────────────────────── */}
        {tags.length > 0 && (
          <View style={styles.field}>
            <Text style={styles.label}>Tags</Text>
            <View style={styles.tagRow}>
              {tags.map((tag) => {
                const selected = selectedTagIds.has(tag.id);
                return (
                  <TouchableOpacity
                    key={tag.id}
                    style={[styles.tagChip, selected && styles.tagChipSelected]}
                    onPress={() => toggleTag(tag.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Tag ${tag.name}${
                      selected ? ", selected" : ""
                    }`}
                  >
                    <Text
                      style={[
                        styles.tagChipText,
                        selected && styles.tagChipTextSelected,
                      ]}
                    >
                      {tag.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        <Text style={styles.assetsHint}>
          You&apos;ll add assets and kits on the next screen, after the booking
          is created.
        </Text>
      </ScrollView>

      {/* ── Bottom action bar ──────────────────────── */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[
            styles.submitButton,
            !canSubmit && styles.submitButtonDisabled,
          ]}
          disabled={!canSubmit}
          onPress={handleSubmit}
          accessibilityLabel={
            isSubmitting ? "Creating booking" : "Create booking"
          }
          accessibilityRole="button"
        >
          {isSubmitting ? (
            <ActivityIndicator color={colors.primaryForeground} size="small" />
          ) : (
            <>
              <Ionicons
                name="add-circle"
                size={20}
                color={colors.primaryForeground}
              />
              <Text style={styles.submitButtonText}>Create Booking</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* ── Custodian picker (modal) ───────────────── */}
      {currentOrg && (
        <TeamMemberPicker
          visible={showCustodianPicker}
          orgId={currentOrg.id}
          onSelect={(member) => {
            setCustodian(member);
            setShowCustodianPicker(false);
          }}
          onClose={() => setShowCustodianPicker(false)}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const useStyles = createStyles((colors, shadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: 120,
  },
  field: {
    marginBottom: spacing.lg,
  },
  label: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
    marginBottom: spacing.xs,
  },
  required: {
    color: colors.error,
  },
  input: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: fontSize.lg,
    color: colors.foreground,
    ...shadows.sm,
  },
  textArea: {
    minHeight: 80,
    paddingTop: 12,
  },
  errorHint: {
    fontSize: fontSize.sm,
    color: colors.error,
    marginTop: 4,
  },
  pickerButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    ...shadows.sm,
  },
  pickerPlaceholder: {
    fontSize: fontSize.lg,
    color: colors.mutedLight,
  },
  pickerSelected: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  pickerSelectedText: {
    fontSize: fontSize.lg,
    color: colors.foreground,
    fontWeight: "500",
  },
  dateInlineWrap: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.sm,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  tagChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: borderRadius.pill,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tagChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tagChipText: {
    fontSize: fontSize.sm,
    fontWeight: "500",
    color: colors.muted,
  },
  tagChipTextSelected: {
    color: colors.primaryForeground,
  },
  assetsHint: {
    fontSize: fontSize.sm,
    color: colors.mutedLight,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  bottomBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    paddingBottom: spacing.xxxl,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    ...shadows.lg,
  },
  submitButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: colors.primaryForeground,
    fontSize: fontSize.lg,
    fontWeight: "600",
  },
}));
