import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  Modal,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api, type TeamMember } from "@/lib/api";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";

type Props = {
  visible: boolean;
  orgId: string;
  onSelect: (member: TeamMember) => void;
  onClose: () => void;
};

const memberKeyExtractor = (item: TeamMember) => item.id;

const useStyles = createStyles((colors, shadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: fontSize.xl,
    fontWeight: "600",
    color: colors.foreground,
  },
  closeButton: {
    padding: spacing.xs,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.gray300,
    gap: spacing.sm,
    ...shadows.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.lg,
    color: colors.foreground,
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    gap: spacing.md,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.gray700,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: {
    color: "#FFFFFF",
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  memberInfo: {
    flex: 1,
    gap: 2,
  },
  memberName: {
    fontSize: fontSize.lg,
    fontWeight: "600",
    color: colors.foreground,
  },
  memberRole: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
  },
  errorText: {
    fontSize: fontSize.base,
    color: colors.muted,
    textAlign: "center",
    paddingHorizontal: spacing.xxxl,
  },
  emptyText: {
    fontSize: fontSize.base,
    color: colors.muted,
    textAlign: "center",
    paddingHorizontal: spacing.xxxl,
  },
  retryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xxl,
    paddingVertical: 10,
    borderRadius: borderRadius.lg,
    marginTop: spacing.sm,
  },
  retryText: {
    color: colors.primaryForeground,
    fontWeight: "600",
    fontSize: fontSize.base,
  },
}));

export function TeamMemberPicker({ visible, orgId, onSelect, onClose }: Props) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const { colors } = useTheme();
  const styles = useStyles();

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchMembers = useCallback(async () => {
    if (!orgId) return;
    setIsLoading(true);
    setError(null);

    const { data, error: fetchErr } = await api.teamMembers(
      orgId,
      debouncedSearch || undefined
    );

    if (fetchErr || !data) {
      setError(fetchErr || "Failed to load team members");
    } else {
      setMembers(data.teamMembers);
    }
    setIsLoading(false);
  }, [orgId, debouncedSearch]);

  // Track when the initial (non-search) data was last fetched
  const lastFetchedAt = useRef(0);
  const PICKER_CACHE_TTL = 5 * 60_000; // 5 minutes

  useEffect(() => {
    if (visible) {
      // Always fetch when searching; cache only the initial load
      if (debouncedSearch) {
        fetchMembers();
      } else {
        const isStale = Date.now() - lastFetchedAt.current > PICKER_CACHE_TTL;
        if (members.length === 0 || isStale) {
          fetchMembers().then(() => {
            lastFetchedAt.current = Date.now();
          });
        }
      }
    } else {
      // Reset search but keep members cached for fast re-open
      setSearch("");
      setDebouncedSearch("");
    }
    // why: PICKER_CACHE_TTL is a module constant; debouncedSearch and members.length
    // are read only inside the visibility branch and listing them would re-fire the
    // effect on every keystroke
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, fetchMembers]);

  const getDisplayName = (member: TeamMember) => {
    if (member.user) {
      const { firstName, lastName } = member.user;
      const fullName = [firstName, lastName].filter(Boolean).join(" ");
      return fullName || member.name;
    }
    return member.name;
  };

  const getInitials = (member: TeamMember) => {
    if (member.user?.firstName) {
      return (
        (member.user.firstName[0] || "") + (member.user.lastName?.[0] || "")
      ).toUpperCase();
    }
    return (member.name?.[0] || "?").toUpperCase();
  };

  const renderMember = ({ item }: { item: TeamMember }) => (
    <TouchableOpacity
      style={styles.memberRow}
      onPress={() => onSelect(item)}
      activeOpacity={0.7}
      accessibilityLabel={`Select ${getDisplayName(item)}`}
      accessibilityRole="button"
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{getInitials(item)}</Text>
      </View>
      <View style={styles.memberInfo}>
        <Text style={styles.memberName}>{getDisplayName(item)}</Text>
        {item.user && item.name !== getDisplayName(item) && (
          <Text style={styles.memberRole}>{item.name}</Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.mutedLight} />
    </TouchableOpacity>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container} accessibilityViewIsModal={true}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Select Team Member</Text>
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeButton}
            accessibilityLabel="Close team member picker"
            accessibilityRole="button"
          >
            <Ionicons name="close" size={24} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={18} color={colors.mutedLight} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search team members..."
            placeholderTextColor={colors.placeholderText}
            autoCorrect={false}
            autoFocus
            accessibilityLabel="Search team members"
          />
          {search.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearch("")}
              accessibilityLabel="Clear search"
              accessibilityRole="button"
            >
              <Ionicons
                name="close-circle"
                size={18}
                color={colors.mutedLight}
              />
            </TouchableOpacity>
          )}
        </View>

        {/* Content */}
        {error ? (
          <View style={styles.centered}>
            <Ionicons
              name="alert-circle-outline"
              size={48}
              color={colors.error}
            />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={fetchMembers}
              accessibilityLabel="Retry loading team members"
              accessibilityRole="button"
            >
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.muted} />
          </View>
        ) : members.length === 0 ? (
          <View style={styles.centered}>
            <Ionicons
              name="people-outline"
              size={48}
              color={colors.mutedLight}
            />
            <Text style={styles.emptyText}>
              {debouncedSearch
                ? "No team members match your search"
                : "No team members found"}
            </Text>
          </View>
        ) : (
          <FlatList
            data={members}
            renderItem={renderMember}
            keyExtractor={memberKeyExtractor}
            removeClippedSubviews
            initialNumToRender={15}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}
