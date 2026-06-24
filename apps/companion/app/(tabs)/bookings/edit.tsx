/**
 * Edit-booking screen.
 *
 * Loads a booking and lets the user edit its basic info. The status-aware field
 * mask mirrors the server (`updateBasicBooking`): name / description / tags are
 * always editable; start / end dates and custodian are only editable while the
 * booking is a DRAFT (the server ignores them otherwise). On save the booking
 * detail is marked dirty so it refetches.
 *
 * Reached via `/(tabs)/bookings/edit?id=...`.
 *
 * @see {@link file://./new.tsx} the create screen this mirrors.
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
import { useRouter, useLocalSearchParams } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { api, type BookingTag } from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import { markBookingDirty } from "@/lib/booking-refresh";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { labelForRequired } from "@/lib/a11y";
import { TeamMemberPicker } from "@/components/team-member-picker";

function getTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function toLocalWire(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
}

function formatDisplay(d: Date): string {
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function EditBookingScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentOrg } = useOrg();
  const { colors } = useTheme();
  const styles = useStyles();

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isDraft, setIsDraft] = useState(false);

  // ── Form state ──────────────────────────────────
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [custodian, setCustodian] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [from, setFrom] = useState<Date | null>(null);
  const [to, setTo] = useState<Date | null>(null);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [showCustodianPicker, setShowCustodianPicker] = useState(false);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);

  const [tags, setTags] = useState<BookingTag[]>([]);

  // Snapshot of the loaded booking — drives the "real change" discard guard so
  // backing out without editing doesn't prompt (declared before the load
  // effect that populates it).
  const didSubmitRef = useRef(false);
  const initialRef = useRef<{
    name: string;
    description: string;
    custodianId: string | null;
    from: number;
    to: number;
    tagIds: string;
  } | null>(null);

  // ── Load booking + tags ─────────────────────────
  useEffect(() => {
    if (!id || !currentOrg) return;
    let active = true;
    setIsLoading(true);
    Promise.all([
      api.booking(id, currentOrg.id),
      api.bookingTags(currentOrg.id),
    ]).then(([bookingRes, tagsRes]) => {
      if (!active) return;
      if (bookingRes.error || !bookingRes.data) {
        setLoadError(bookingRes.error || "Failed to load booking.");
        setIsLoading(false);
        return;
      }
      const b = bookingRes.data.booking;
      setName(b.name);
      setDescription(b.description ?? "");
      setCustodian(
        b.custodianTeamMember
          ? { id: b.custodianTeamMember.id, name: b.custodianTeamMember.name }
          : null
      );
      setFrom(new Date(b.from));
      setTo(new Date(b.to));
      setSelectedTagIds(new Set(b.tags.map((t) => t.id)));
      setIsDraft(b.status === "DRAFT");
      // Snapshot the loaded values so the discard guard only fires on a REAL
      // change (and never on the load-error path).
      initialRef.current = {
        name: b.name,
        description: b.description ?? "",
        custodianId: b.custodianTeamMember?.id ?? null,
        from: new Date(b.from).getTime(),
        to: new Date(b.to).getTime(),
        tagIds: [...b.tags.map((t) => t.id)].sort().join(","),
      };
      if (tagsRes.data?.tags) setTags(tagsRes.data.tags);
      setIsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [id, currentOrg]);

  // ── Unsaved-changes guard (only after a REAL edit) ─────
  const navigation = useNavigation();

  // Compare the current form against the loaded snapshot so the discard prompt
  // only appears when something actually changed (and never on load-error).
  const snap = initialRef.current;
  const hasUnsavedChanges = snap
    ? name !== snap.name ||
      description !== snap.description ||
      (custodian?.id ?? null) !== snap.custodianId ||
      (from ? from.getTime() : null) !== snap.from ||
      (to ? to.getTime() : null) !== snap.to ||
      [...selectedTagIds].sort().join(",") !== snap.tagIds
    : false;

  useEffect(() => {
    if (isLoading || !hasUnsavedChanges) return;
    const unsubscribe = navigation.addListener("beforeRemove", (e) => {
      if (didSubmitRef.current || !hasUnsavedChanges) return;
      e.preventDefault();
      Alert.alert("Discard changes?", "Your edits won't be saved.", [
        { text: "Keep Editing", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => navigation.dispatch(e.data.action),
        },
      ]);
    });
    return unsubscribe;
  }, [navigation, isLoading, hasUnsavedChanges]);

  // ── Date pickers ────────────────────────────────
  const onFromChange = useCallback(
    (event: DateTimePickerEvent, selected: Date | undefined) => {
      if (Platform.OS === "android") setShowFromPicker(false);
      if (event.type === "dismissed") return;
      if (selected) {
        setFrom(selected);
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

  const toggleTag = useCallback((tagId: string) => {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }, []);

  // ── Submit ──────────────────────────────────────
  const handleSubmit = async () => {
    if (!currentOrg || !id) return;
    if (name.trim().length < 2) {
      Alert.alert("Validation", "Name must be at least 2 characters.");
      return;
    }
    if (!custodian) {
      Alert.alert("Validation", "Please select a custodian.");
      return;
    }
    if (!from || !to) {
      Alert.alert("Validation", "Start and end date-times are required.");
      return;
    }
    if (to <= from) {
      Alert.alert("Validation", "End date must be after the start date.");
      return;
    }

    setIsSubmitting(true);
    const { error } = await api.updateBooking(currentOrg.id, {
      bookingId: id,
      name: name.trim(),
      description: description.trim() || undefined,
      custodianTeamMemberId: custodian.id,
      startDate: toLocalWire(from),
      endDate: toLocalWire(to),
      timeZone: getTimeZone(),
      tags: Array.from(selectedTagIds),
    });
    setIsSubmitting(false);

    if (error) {
      Alert.alert("Couldn't save changes", error);
      return;
    }

    didSubmitRef.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Detail screen refetches because we marked it dirty.
    markBookingDirty(id);
    router.back();
  };

  const canSubmit =
    name.trim().length >= 2 && !!custodian && !!from && !!to && !isSubmitting;

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.muted} />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
        <Text style={styles.errorText}>{loadError}</Text>
      </View>
    );
  }

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
        {!isDraft && (
          <View style={styles.lockedBanner}>
            <Ionicons
              name="lock-closed-outline"
              size={16}
              color={colors.muted}
            />
            <Text style={styles.lockedBannerText}>
              Dates and custodian can only be changed while the booking is a
              draft.
            </Text>
          </View>
        )}

        {/* ── Name (required) ──────────────────────── */}
        <View style={styles.field}>
          <Text style={styles.label}>
            Name <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Booking name"
            placeholderTextColor={colors.placeholderText}
            returnKeyType="next"
            maxLength={100}
            accessibilityLabel={labelForRequired("Booking name")}
          />
          {name.length > 0 && name.trim().length < 2 && (
            <Text style={styles.errorHint} accessibilityRole="alert">
              Must be at least 2 characters
            </Text>
          )}
        </View>

        {/* ── Description ───────────────────────────── */}
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

        {/* ── Custodian (DRAFT-only) ───────────────── */}
        <View style={styles.field}>
          <Text style={styles.label}>
            Custodian <Text style={styles.required}>*</Text>
          </Text>
          <TouchableOpacity
            style={[styles.pickerButton, !isDraft && styles.pickerDisabled]}
            disabled={!isDraft}
            onPress={() => setShowCustodianPicker(true)}
            accessibilityRole="button"
            accessibilityLabel={
              custodian ? `Custodian: ${custodian.name}` : "Select a custodian"
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
            {isDraft && (
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.mutedLight}
              />
            )}
          </TouchableOpacity>
        </View>

        {/* ── Start / End (DRAFT-only) ─────────────── */}
        <View style={styles.field}>
          <Text style={styles.label}>
            Starts <Text style={styles.required}>*</Text>
          </Text>
          <TouchableOpacity
            style={[styles.pickerButton, !isDraft && styles.pickerDisabled]}
            disabled={!isDraft}
            onPress={() => {
              setShowFromPicker((o) => !o);
              setShowToPicker(false);
            }}
            accessibilityRole="button"
            accessibilityLabel={
              from ? `Starts ${formatDisplay(from)}` : "Start"
            }
          >
            <Text
              style={
                from ? styles.pickerSelectedText : styles.pickerPlaceholder
              }
            >
              {from ? formatDisplay(from) : "Choose start..."}
            </Text>
            {isDraft && (
              <Ionicons
                name="calendar-outline"
                size={18}
                color={colors.mutedLight}
              />
            )}
          </TouchableOpacity>
          {isDraft && showFromPicker && (
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
            style={[styles.pickerButton, !isDraft && styles.pickerDisabled]}
            disabled={!isDraft}
            onPress={() => {
              setShowToPicker((o) => !o);
              setShowFromPicker(false);
            }}
            accessibilityRole="button"
            accessibilityLabel={to ? `Ends ${formatDisplay(to)}` : "End"}
          >
            <Text
              style={to ? styles.pickerSelectedText : styles.pickerPlaceholder}
            >
              {to ? formatDisplay(to) : "Choose end..."}
            </Text>
            {isDraft && (
              <Ionicons
                name="calendar-outline"
                size={18}
                color={colors.mutedLight}
              />
            )}
          </TouchableOpacity>
          {isDraft && showToPicker && (
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

        {/* ── Tags ─────────────────────────────────── */}
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
      </ScrollView>

      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[
            styles.submitButton,
            !canSubmit && styles.submitButtonDisabled,
          ]}
          disabled={!canSubmit}
          onPress={handleSubmit}
          accessibilityLabel={isSubmitting ? "Saving" : "Save changes"}
          accessibilityRole="button"
        >
          {isSubmitting ? (
            <ActivityIndicator color={colors.primaryForeground} size="small" />
          ) : (
            <>
              <Ionicons
                name="checkmark-circle"
                size={20}
                color={colors.primaryForeground}
              />
              <Text style={styles.submitButtonText}>Save Changes</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {currentOrg && (
        <TeamMemberPicker
          visible={showCustodianPicker}
          orgId={currentOrg.id}
          onSelect={(member) => {
            setCustodian({ id: member.id, name: member.name });
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
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.xl,
  },
  errorText: {
    fontSize: fontSize.base,
    color: colors.muted,
    textAlign: "center",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: 120,
  },
  lockedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.backgroundTertiary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  lockedBannerText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.muted,
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
  pickerDisabled: {
    backgroundColor: colors.backgroundTertiary,
    opacity: 0.7,
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
