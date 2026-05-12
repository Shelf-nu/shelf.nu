import { memo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { AssetNote } from "@/lib/api";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { fontSize, spacing, borderRadius, formatDate } from "@/lib/constants";

interface NotesSectionProps {
  notes: AssetNote[] | undefined;
  noteText: string;
  onChangeNoteText: (text: string) => void;
  onPostNote: () => void;
  isPostingNote: boolean;
  /**
   * When `false` the post-note input and button are disabled with a hint
   * label. The parent uses this to surface the case where the workspace
   * context (`currentOrg`) hasn't resolved yet — without it the user can
   * type a note, tap Post, and silently get nothing because the parent
   * `handlePostNote` early-returns on missing `orgId`.
   */
  canPostNote?: boolean;
}

export const NotesSection = memo(function NotesSection({
  notes,
  noteText,
  onChangeNoteText,
  onPostNote,
  isPostingNote,
  canPostNote = true,
}: NotesSectionProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  const postDisabled = !noteText.trim() || isPostingNote || !canPostNote;

  return (
    <View style={styles.sectionContainer}>
      <Text style={styles.sectionTitle}>
        Activity{notes?.length ? ` (${notes.length})` : ""}
      </Text>

      {/* Add note input */}
      <View style={styles.noteInputContainer}>
        <TextInput
          style={styles.noteInput}
          value={noteText}
          onChangeText={onChangeNoteText}
          placeholder={canPostNote ? "Add a note..." : "Loading workspace…"}
          placeholderTextColor={colors.placeholderText}
          editable={canPostNote}
          multiline
          maxLength={5000}
          accessibilityLabel="Add a note"
          accessibilityHint={
            canPostNote ? undefined : "Workspace context is still loading."
          }
        />
        <TouchableOpacity
          style={[
            styles.notePostBtn,
            postDisabled && styles.notePostBtnDisabled,
          ]}
          onPress={onPostNote}
          disabled={postDisabled}
          accessibilityLabel="Post note"
          accessibilityHint={
            canPostNote
              ? undefined
              : "Disabled until the workspace context loads."
          }
          accessibilityRole="button"
          accessibilityState={{ disabled: postDisabled }}
        >
          {isPostingNote ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <Ionicons name="send" size={16} color={colors.primaryForeground} />
          )}
        </TouchableOpacity>
      </View>

      {/* Notes list */}
      {notes && notes.length > 0 ? (
        <View style={styles.notesList}>
          {notes.map((note) => (
            <NoteItem key={note.id} note={note} />
          ))}
        </View>
      ) : (
        <Text style={styles.emptyNotes}>No activity yet</Text>
      )}
    </View>
  );
});

// ── Helpers ─────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(dateStr);
}

/**
 * Converts Markdoc tag syntax in note content to readable plain text.
 * Handles: {% link text="..." /%}, {% date value="..." /%},
 * {% category_badge name="..." /%}, {% tag name="..." /%},
 * {% booking_status status="..." /%}, {% description ... /%},
 * {% assets_list count=N ... /%}, {% kits_list count=N ... /%},
 * and **bold** markers.
 */
function markdocToPlainText(content: string): string {
  return (
    content
      // {% link to="..." text="Display Text" /%} -> Display Text
      .replace(/{%\s*link\s+[^%]*?text="([^"]*)"[^%]*\/%}/g, "$1")
      // {% date value="2024-01-01T..." /%} -> formatted date
      .replace(
        /{%\s*date\s+value="([^"]*)"[^%]*\/%}/g,
        (_match, iso: string) => {
          try {
            return new Date(iso).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            });
          } catch {
            return iso;
          }
        }
      )
      // {% category_badge name="..." ... /%} -> name
      .replace(/{%\s*category_badge\s+name="([^"]*)"[^%]*\/%}/g, "$1")
      // {% tag name="..." ... /%} -> name
      .replace(/{%\s*tag\s+name="([^"]*)"[^%]*\/%}/g, "$1")
      // {% booking_status status="RESERVED" ... /%} -> Reserved
      .replace(
        /{%\s*booking_status\s+status="([^"]*)"[^%]*\/%}/g,
        (_match, status: string) =>
          status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ")
      )
      // {% assets_list count=3 ... action="added" /%} -> 3 assets added
      .replace(
        /{%\s*assets_list\s+count=(\d+)[^%]*action="([^"]*)"[^%]*\/%}/g,
        "$1 assets $2"
      )
      // {% kits_list count=2 ... action="added" /%} -> 2 kits added
      .replace(
        /{%\s*kits_list\s+count=(\d+)[^%]*action="([^"]*)"[^%]*\/%}/g,
        "$1 kits $2"
      )
      // {% description newText="..." /%} -> (description updated)
      .replace(/{%\s*description[^%]*\/%}/g, "(description updated)")
      // Catch any remaining {% ... /%} tags
      .replace(/{%[^%]*\/%}/g, "")
      // Strip **bold** markers
      .replace(/\*\*/g, "")
      // Clean up &quot; entities
      .replace(/&quot;/g, '"')
      // Clean up extra whitespace
      .replace(/\s+/g, " ")
      .trim()
  );
}

// ── Sub-components ──────────────────────────────────────

const NoteItem = memo(function NoteItem({ note }: { note: AssetNote }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const userName = note.user
    ? [note.user.firstName, note.user.lastName].filter(Boolean).join(" ") ||
      "User"
    : "System";
  const isUpdate = note.type === "UPDATE";

  return (
    <View style={[styles.noteItem, isUpdate && styles.noteItemUpdate]}>
      <View style={styles.noteHeader}>
        <View style={styles.noteUserRow}>
          <View
            style={[styles.noteAvatar, isUpdate && styles.noteAvatarUpdate]}
          >
            <Ionicons
              name={isUpdate ? "refresh-outline" : "chatbubble-outline"}
              size={12}
              color={isUpdate ? colors.muted : colors.primaryForeground}
            />
          </View>
          <Text style={styles.noteUserName}>{userName}</Text>
        </View>
        <Text style={styles.noteTime}>{timeAgo(note.createdAt)}</Text>
      </View>
      <Text style={styles.noteContent} selectable>
        {markdocToPlainText(note.content)}
      </Text>
    </View>
  );
});

const useStyles = createStyles((colors, shadows) => ({
  sectionContainer: { paddingHorizontal: spacing.lg, marginTop: spacing.xl },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  noteInputContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  noteInput: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.gray300,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: fontSize.base,
    color: colors.foreground,
    maxHeight: 80,
    minHeight: 40,
    ...shadows.sm,
  },
  notePostBtn: {
    backgroundColor: colors.primary,
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  notePostBtnDisabled: { opacity: 0.4 },
  notesList: { gap: spacing.sm },
  emptyNotes: {
    fontSize: fontSize.base,
    color: colors.mutedLight,
    textAlign: "center",
    paddingVertical: spacing.xl,
  },
  noteItem: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  noteItemUpdate: {
    borderColor: colors.borderLight,
    backgroundColor: colors.backgroundTertiary,
  },
  noteHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xs,
  },
  noteUserRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  noteAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.iconDefault,
    justifyContent: "center",
    alignItems: "center",
  },
  noteAvatarUpdate: {
    backgroundColor: colors.backgroundTertiary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  noteUserName: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.foreground,
  },
  noteTime: { fontSize: fontSize.xs, color: colors.mutedLight },
  noteContent: {
    fontSize: fontSize.base,
    color: colors.foregroundSecondary,
    lineHeight: 20,
  },
}));
