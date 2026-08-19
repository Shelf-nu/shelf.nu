/**
 * Read-only viewer for evidence already recorded on an audit.
 *
 * The sibling {@link file://./evidence-modal.tsx} WRITES evidence during a
 * live scan. This one only READS, and exists because there was previously no
 * way to read at all: a field worker photographed a damaged asset, completed
 * the audit, and every note and photo they had taken became visible only on
 * the web app. The phone even knew how many there were — the detail payload
 * carries counts — and still could not show one of them.
 *
 * Deliberately has no edit or delete affordance. Removing evidence is a
 * destructive act that belongs on the surface with room to confirm it; this
 * is for looking at the record in the field, including long after the audit
 * closed.
 *
 * @see {@link file://./../../lib/api/audits.ts} `auditEvidence`
 */
import { useCallback } from "react";
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { useDateFormatter } from "@/lib/use-date-formatter";
import type {
  AuditEvidenceImage,
  AuditEvidenceNote,
} from "@/lib/api/types";

type EvidenceViewerProps = {
  visible: boolean;
  onClose: () => void;
  /** Asset name, or a heading for the audit-wide bucket. */
  title: string;
  notes: AuditEvidenceNote[];
  images: AuditEvidenceImage[];
  isLoading?: boolean;
  error?: string | null;
  /** Opens one photo full-screen. Omitted when there is nothing to open into. */
  onImagePress?: (image: AuditEvidenceImage) => void;
};

export function EvidenceViewer({
  visible,
  onClose,
  title,
  notes,
  images,
  isLoading = false,
  error = null,
  onImagePress,
}: EvidenceViewerProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  // why: the workspace's own date format — the same hook every other audit
  // surface uses, so a completed audit does not suddenly render dates
  // differently from the screen that opened it.
  const { formatDateTime } = useDateFormatter();

  const renderNote = useCallback(
    (note: AuditEvidenceNote) => (
      <View key={note.id} style={styles.note}>
        <Text style={styles.noteContent}>{note.content}</Text>
        <Text style={styles.noteMeta}>
          {/* why: the account can be deleted while its evidence survives, so
              the author is nullable. Naming the gap beats an empty gap. */}
          {note.authorName ?? "Unknown"} · {formatDateTime(note.createdAt)}
        </Text>
      </View>
    ),
    [styles, formatDateTime]
  );

  const isEmpty = !isLoading && !error && notes.length === 0 && images.length === 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={24} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          {isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : error ? (
            <View style={styles.centered}>
              <Text style={styles.empty}>{error}</Text>
            </View>
          ) : isEmpty ? (
            <View style={styles.centered}>
              <Text style={styles.empty}>
                Nothing was recorded against this one.
              </Text>
            </View>
          ) : (
            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
            >
              {images.length > 0 ? (
                <>
                  <Text style={styles.sectionLabel}>
                    {images.length === 1 ? "1 photo" : `${images.length} photos`}
                  </Text>
                  <View style={styles.grid}>
                    {images.map((image) => (
                      <TouchableOpacity
                        key={image.id}
                        activeOpacity={onImagePress ? 0.7 : 1}
                        onPress={
                          onImagePress ? () => onImagePress(image) : undefined
                        }
                        accessibilityRole={onImagePress ? "button" : "image"}
                        accessibilityLabel={
                          image.description
                            ? `Photo: ${image.description}`
                            : `Photo by ${image.authorName ?? "Unknown"}`
                        }
                      >
                        <Image
                          source={{ uri: image.thumbnailUrl }}
                          style={styles.thumb}
                          contentFit="cover"
                        />
                        {image.description ? (
                          <Text style={styles.caption} numberOfLines={2}>
                            {image.description}
                          </Text>
                        ) : null}
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              ) : null}

              {notes.length > 0 ? (
                <>
                  <Text style={styles.sectionLabel}>
                    {notes.length === 1 ? "1 note" : `${notes.length} notes`}
                  </Text>
                  {notes.map(renderNote)}
                </>
              ) : null}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = createStyles((colors) => ({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: borderRadius.lg,
    borderTopRightRadius: borderRadius.lg,
    maxHeight: "85%",
    paddingBottom: spacing.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  title: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.foreground,
  },
  body: { flexGrow: 0 },
  bodyContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  centered: {
    padding: spacing.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: {
    fontSize: fontSize.sm,
    // why: `muted`, not `mutedLight` — the lighter grey is the icon/large-text
    // token and misses 4.5:1 at this size.
    color: colors.muted,
    textAlign: "center",
  },
  sectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: spacing.sm,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  thumb: {
    width: 104,
    height: 104,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.borderLight,
  },
  caption: {
    width: 104,
    marginTop: 4,
    fontSize: fontSize.xs,
    color: colors.muted,
  },
  note: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    gap: 6,
  },
  noteContent: {
    fontSize: fontSize.sm,
    color: colors.foreground,
    lineHeight: 20,
  },
  noteMeta: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },
}));
