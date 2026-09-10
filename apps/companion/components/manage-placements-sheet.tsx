/**
 * ManagePlacementsSheet — a page-sheet modal that edits a QUANTITY_TRACKED
 * asset's manual placement set: one row per location with its own quantity,
 * add/remove rows, and a live placed / via-kits / unplaced meter. Mobile
 * twin of the web "Manage placements" dialog
 * (apps/webapp/app/components/assets/manage-placements-form.tsx) — both
 * submit the full desired set and the server replaces the manual rows
 * atomically, so removing every row unplaces the asset.
 *
 * Kit-driven placements are rendered read-only above the editable rows and
 * do NOT reduce the unplaced pool: the location and kit axes are bounded
 * independently, so a kit slice takes nothing away from what can be placed
 * manually. To change one, the user edits the kit itself.
 *
 * The over-placed state (manual sum above the asset's total) is reachable
 * without the user doing anything wrong — consuming stock lowers the total
 * without touching placements — so when the sheet OPENS over-placed the
 * message explains that, and Save stays disabled until the numbers fit.
 *
 * Follows the house selection-flow contract (AdjustQuantitySheet /
 * QuantityInputSheet): `<Modal animationType="slide"
 * presentationStyle="pageSheet">` + SafeAreaView + header-with-close.
 * Locations are added through the shared LocationPicker, presented as a
 * second sheet above this one.
 *
 * INDIVIDUAL assets never see this sheet — the caller keeps the plain
 * location picker + confirm alert for them.
 *
 * @see {@link file://../app/(tabs)/assets/[id].tsx} the consumer
 * @see {@link file://./location-picker.tsx} the nested location picker
 */
import { useEffect, useMemo, useReducer, useState } from "react";
import {
  View,
  Text,
  Modal,
  ScrollView,
  TextInput,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { formatQuantity } from "@/lib/quantity-format";
import { LocationPicker } from "@/components/location-picker";
import type { AssetPlacement } from "@/lib/api/types";

type EditableRow = {
  /** Stable client-side row id so removes don't re-key sibling rows. */
  rowId: string;
  locationId: string;
  locationName: string;
  /** Per-row AssetLocation.quantity — units placed at this location. */
  quantity: number;
};

type Props = {
  /** Whether the sheet is shown. */
  visible: boolean;
  /** Workspace id for the nested location picker. */
  orgId: string;
  /** The asset's total pool (`Asset.quantity`) — the bound on the manual sum. */
  totalQuantity: number;
  /** Display unit echoed in copy (e.g. "pcs"); null/undefined falls back to "units". */
  unitOfMeasure?: string | null;
  /**
   * Current placement set (manual + kit rows). The sheet edits the manual
   * rows and shows kit-driven rows read-only.
   */
  initialPlacements: AssetPlacement[];
  /**
   * Called with the full desired manual set on Save. An empty array
   * unplaces the asset. The caller closes the sheet and performs the
   * request.
   */
  onSave: (placements: { locationId: string; quantity: number }[]) => void;
  /** Called when the user dismisses the sheet without saving. */
  onClose: () => void;
};

/**
 * The editor's coupled state. The rows and the two banners always move
 * together (adding a row clears the duplicate hint, reopening resets all
 * three), so they live in one reducer rather than separate `useState` calls.
 */
type EditorState = {
  rows: EditableRow[];
  /** Set when the picker returns a location that already has a row. */
  duplicateHint: string | null;
  /**
   * True when the sheet OPENED with the manual sum above the total. A
   * per-open snapshot rather than derived state: it keeps the "stock was used
   * up while every unit was placed" explanation on screen while the user
   * fixes the numbers, which is exactly when it is needed.
   */
  openedOverPlaced: boolean;
};

type EditorAction =
  | { type: "reset"; rows: EditableRow[]; openedOverPlaced: boolean }
  | { type: "addRow"; row: EditableRow }
  | { type: "duplicateLocation"; locationName: string }
  | { type: "removeRow"; rowId: string }
  | { type: "setQuantity"; rowId: string; quantity: number };

/**
 * Applies one editor transition.
 *
 * @param state - Current editor state.
 * @param action - The transition to apply.
 * @returns The next state.
 */
function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "reset":
      return {
        rows: action.rows,
        duplicateHint: null,
        openedOverPlaced: action.openedOverPlaced,
      };
    case "addRow":
      return {
        ...state,
        rows: [...state.rows, action.row],
        duplicateHint: null,
      };
    case "duplicateLocation":
      return {
        ...state,
        duplicateHint: `${action.locationName} is already listed below.`,
      };
    case "removeRow":
      return {
        ...state,
        rows: state.rows.filter((r) => r.rowId !== action.rowId),
        duplicateHint: null,
      };
    case "setQuantity":
      return {
        ...state,
        rows: state.rows.map((r) =>
          r.rowId === action.rowId ? { ...r, quantity: action.quantity } : r
        ),
      };
  }
}

let rowCounter = 0;
function nextRowId() {
  rowCounter += 1;
  return `placement-row-${rowCounter}`;
}

/**
 * Multi-row placement editor for QUANTITY_TRACKED assets.
 *
 * Owns the row state and client-side validation; hands the full desired
 * set to `onSave`. The server re-validates everything against the
 * row-locked asset, so this validation exists for immediate feedback, not
 * enforcement.
 *
 * @param props - See {@link Props}.
 * @returns The modal sheet element.
 */
export function ManagePlacementsSheet({
  visible,
  orgId,
  totalQuantity,
  unitOfMeasure,
  initialPlacements,
  onSave,
  onClose,
}: Props) {
  const { colors } = useTheme();
  const styles = useStyles();

  const [{ rows, duplicateHint, openedOverPlaced }, dispatch] = useReducer(
    editorReducer,
    { rows: [], duplicateHint: null, openedOverPlaced: false }
  );
  const [showLocationPicker, setShowLocationPicker] = useState(false);

  // Re-seed the editable rows every time the sheet opens: each open edits
  // the placements as they are NOW, so stale rows must not leak across.
  useEffect(() => {
    if (!visible) return;
    const manual = initialPlacements.filter((p) => p.viaKit === null);
    dispatch({
      type: "reset",
      rows: manual.map((p) => ({
        rowId: nextRowId(),
        locationId: p.locationId,
        locationName: p.locationName,
        quantity: p.quantity,
      })),
      openedOverPlaced:
        manual.reduce((s, p) => s + p.quantity, 0) > totalQuantity,
    });
    // why: seed from the props as they are at the moment the sheet opens —
    // re-seeding on every initialPlacements identity change would wipe
    // in-progress edits when the parent refetches in the background.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const unitLabel = unitOfMeasure || "units";
  const totalLabel =
    formatQuantity(totalQuantity, unitOfMeasure) ?? String(totalQuantity);

  const kitRows = useMemo(
    () => initialPlacements.filter((p) => p.viaKit !== null),
    [initialPlacements]
  );
  const kitSum = kitRows.reduce((s, p) => s + p.quantity, 0);

  /** Manual sum — drives the meter and the sum-within-total validation. */
  const placedSum = rows.reduce((s, r) => s + (r.quantity || 0), 0);
  const unplaced = Math.max(0, totalQuantity - placedSum);
  const overPlacedBy = Math.max(0, placedSum - totalQuantity);

  /**
   * Client-side validation, mirroring the web form. Manual rows only: the
   * kit axis is bounded separately server-side, so counting `kitSum` here
   * would block states the database accepts.
   */
  const clientError = useMemo(() => {
    // A cleared input parks the row at 0 so typing can start fresh; the
    // row must be filled (or removed) before the set can be saved.
    const emptyRow = rows.find((r) => r.quantity < 1);
    if (emptyRow) {
      return `Enter a quantity for ${emptyRow.locationName}, or remove the row.`;
    }
    if (placedSum > totalQuantity) {
      if (openedOverPlaced) {
        return `These locations hold ${placedSum} ${unitLabel} between them, but the asset's total is now ${totalQuantity}. Stock was used up while every unit was assigned to a location, so ${
          placedSum - totalQuantity
        } ${unitLabel} are still recorded somewhere they no longer are. Lower the location that lost them, then save.`;
      }
      return `Placements add up to ${placedSum}, but the asset has only ${totalQuantity} ${unitLabel} in total.`;
    }
    const seen = new Set<string>();
    for (const r of rows) {
      if (seen.has(r.locationId)) {
        return "Each location can appear at most once. Remove the duplicate row.";
      }
      seen.add(r.locationId);
    }
    return null;
  }, [placedSum, totalQuantity, openedOverPlaced, unitLabel, rows]);

  const canAddRow = unplaced > 0;

  const setRowQuantity = (rowId: string, quantity: number) => {
    dispatch({ type: "setQuantity", rowId, quantity });
  };

  /** Step a row's quantity by `delta`, clamped to `1..totalQuantity`. */
  const stepRow = (row: EditableRow, delta: number) => {
    dispatch({
      type: "setQuantity",
      rowId: row.rowId,
      quantity: Math.min(Math.max(row.quantity + delta, 1), totalQuantity),
    });
  };

  const removeRow = (rowId: string) => {
    dispatch({ type: "removeRow", rowId });
  };

  const addLocation = (location: { id: string; name: string }) => {
    setShowLocationPicker(false);
    if (rows.some((r) => r.locationId === location.id)) {
      dispatch({ type: "duplicateLocation", locationName: location.name });
      return;
    }
    dispatch({
      type: "addRow",
      row: {
        rowId: nextRowId(),
        locationId: location.id,
        locationName: location.name,
        quantity: Math.max(1, unplaced),
      },
    });
  };

  const save = () => {
    if (clientError) return;
    onSave(
      rows.map((r) => ({ locationId: r.locationId, quantity: r.quantity }))
    );
  };

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
          <Text style={styles.headerTitle}>Manage Placements</Text>
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeButton}
            accessibilityLabel="Close manage placements"
            accessibilityRole="button"
          >
            <Ionicons name="close" size={24} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.subtitle}>
            Spread this asset across one or more locations. Units not placed
            anywhere stay in the unplaced pool.
          </Text>

          {/* Read-only kit-driven placements */}
          <KitPlacementList rows={kitRows} unitOfMeasure={unitOfMeasure} />

          {/* Editable placement rows */}
          {rows.map((row) => (
            <PlacementRow
              key={row.rowId}
              row={row}
              totalQuantity={totalQuantity}
              unitLabel={unitLabel}
              onStep={stepRow}
              onSetQuantity={setRowQuantity}
              onRemove={removeRow}
            />
          ))}

          {rows.length === 0 ? (
            <Text style={styles.emptyHint}>
              No placements. Saving like this leaves every unit in the unplaced
              pool.
            </Text>
          ) : null}

          {/* Add location */}
          <TouchableOpacity
            style={[styles.addButton, !canAddRow && styles.addButtonDisabled]}
            onPress={() => setShowLocationPicker(true)}
            disabled={!canAddRow}
            activeOpacity={0.7}
            accessibilityLabel="Add location"
            accessibilityRole="button"
            accessibilityState={{ disabled: !canAddRow }}
          >
            <Ionicons name="add" size={18} color={colors.foreground} />
            <Text style={styles.addButtonText}>
              {rows.length > 0 ? "Add another location" : "Add location"}
            </Text>
          </TouchableOpacity>

          {duplicateHint ? (
            <Text style={styles.duplicateHint}>{duplicateHint}</Text>
          ) : null}

          {/* Placed / via kits / unplaced meter */}
          <PlacementMeter
            placedSum={placedSum}
            totalLabel={totalLabel}
            kitSum={kitSum}
            overPlacedBy={overPlacedBy}
            unplaced={unplaced}
            unitLabel={unitLabel}
          />

          {clientError ? (
            <View style={styles.errorBox}>
              <Ionicons
                name="warning-outline"
                size={18}
                color={colors.warningText}
              />
              <Text style={styles.errorText}>{clientError}</Text>
            </View>
          ) : null}

          {/* Save */}
          <TouchableOpacity
            style={[
              styles.confirmPrimary,
              clientError != null && styles.confirmDisabled,
            ]}
            onPress={save}
            disabled={clientError != null}
            activeOpacity={0.7}
            accessibilityLabel="Save placements"
            accessibilityRole="button"
            accessibilityState={{ disabled: clientError != null }}
          >
            <Ionicons
              name="checkmark"
              size={20}
              color={colors.primaryForeground}
            />
            <Text style={styles.confirmText}>Save placements</Text>
          </TouchableOpacity>

          {/* Cancel */}
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={onClose}
            activeOpacity={0.7}
            accessibilityLabel="Cancel manage placements"
            accessibilityRole="button"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Location picker, presented above this sheet */}
        <LocationPicker
          visible={showLocationPicker}
          orgId={orgId}
          onSelect={addLocation}
          onClose={() => setShowLocationPicker(false)}
        />
      </SafeAreaView>
    </Modal>
  );
}

/**
 * Read-only list of placements a kit owns. Rendered above the editable rows
 * so the user sees the whole picture; these change only through the kit
 * itself, and they do not reduce the unplaced pool.
 *
 * @param props.rows - Kit-driven placements; renders nothing when empty.
 * @param props.unitOfMeasure - Display unit for the per-row count.
 * @returns The read-only block, or null.
 */
function KitPlacementList({
  rows,
  unitOfMeasure,
}: {
  rows: AssetPlacement[];
  unitOfMeasure?: string | null;
}) {
  const styles = useStyles();
  if (rows.length === 0) return null;

  return (
    <View style={styles.kitBlock}>
      <Text style={styles.kitBlockLabel}>
        Placements managed by kits (read-only)
      </Text>
      {rows.map((p) => (
        <View key={`${p.locationId}-${p.viaKit?.id}`} style={styles.kitRow}>
          <Text style={styles.kitRowName} numberOfLines={1}>
            {p.locationName}
          </Text>
          <Text style={styles.kitRowMeta} numberOfLines={1}>
            via kit {p.viaKit?.name} ·{" "}
            {formatQuantity(p.quantity, unitOfMeasure) ?? p.quantity}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Allocation summary for the asset's pool: what the editable rows place, what
 * kits hold on their own axis, and the remainder. Shows the remainder as
 * "Over-placed" when the rows claim more units than the asset owns.
 *
 * @param props.placedSum - Units the editable rows currently place.
 * @param props.totalLabel - The asset's pool, already unit-formatted.
 * @param props.kitSum - Units held by kit-driven rows; hidden when zero.
 * @param props.overPlacedBy - Units claimed beyond the pool; hidden when zero.
 * @param props.unplaced - Units placed nowhere.
 * @param props.unitLabel - Unit suffix.
 * @returns The meter element.
 */
function PlacementMeter({
  placedSum,
  totalLabel,
  kitSum,
  overPlacedBy,
  unplaced,
  unitLabel,
}: {
  placedSum: number;
  totalLabel: string;
  kitSum: number;
  overPlacedBy: number;
  unplaced: number;
  unitLabel: string;
}) {
  const styles = useStyles();

  return (
    <View style={styles.meter}>
      <View style={styles.meterLine}>
        <Text style={styles.meterLabel}>Placed</Text>
        <Text style={styles.meterValue}>
          {placedSum} / {totalLabel}
        </Text>
      </View>
      {kitSum > 0 ? (
        <View style={styles.meterLine}>
          <Text style={styles.meterKitLabel}>Via kits</Text>
          <Text style={styles.meterKitValue}>
            {kitSum} {unitLabel}
          </Text>
        </View>
      ) : null}
      {overPlacedBy > 0 ? (
        <View style={styles.meterLine}>
          <Text style={styles.meterErrorLabel}>Over-placed</Text>
          <Text style={styles.meterErrorValue}>
            {overPlacedBy} {unitLabel}
          </Text>
        </View>
      ) : (
        <View style={styles.meterLine}>
          <Text style={styles.meterMutedLabel}>Unplaced</Text>
          <Text style={styles.meterMutedValue}>
            {unplaced} {unitLabel}
          </Text>
        </View>
      )}
    </View>
  );
}

/**
 * One editable placement: the location it names, a remove control, and a
 * quantity stepper bounded to `1..totalQuantity`.
 *
 * @param props.row - The row being edited.
 * @param props.totalQuantity - The asset's pool; the per-row upper bound.
 * @param props.unitLabel - Unit suffix shown after the stepper.
 * @param props.onStep - Steps this row's quantity by a delta.
 * @param props.onSetQuantity - Sets this row's quantity outright.
 * @param props.onRemove - Drops this row from the set.
 * @returns The row element.
 */
function PlacementRow({
  row,
  totalQuantity,
  unitLabel,
  onStep,
  onSetQuantity,
  onRemove,
}: {
  row: EditableRow;
  totalQuantity: number;
  unitLabel: string;
  onStep: (row: EditableRow, delta: number) => void;
  onSetQuantity: (rowId: string, quantity: number) => void;
  onRemove: (rowId: string) => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();

  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <Ionicons
          name="location-outline"
          size={16}
          color={colors.foregroundSecondary}
        />
        <Text style={styles.rowName} numberOfLines={1}>
          {row.locationName}
        </Text>
        <TouchableOpacity
          onPress={() => onRemove(row.rowId)}
          style={styles.removeButton}
          accessibilityLabel={`Remove ${row.locationName}`}
          accessibilityRole="button"
        >
          <Ionicons
            name="trash-outline"
            size={18}
            color={colors.foregroundSecondary}
          />
        </TouchableOpacity>
      </View>
      <View style={styles.quantityRow}>
        <TouchableOpacity
          style={[
            styles.stepButton,
            row.quantity <= 1 && styles.stepButtonDisabled,
          ]}
          onPress={() => onStep(row, -1)}
          disabled={row.quantity <= 1}
          activeOpacity={0.7}
          accessibilityLabel={`Decrease ${row.locationName} quantity`}
          accessibilityRole="button"
          accessibilityState={{ disabled: row.quantity <= 1 }}
        >
          <Ionicons name="remove" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          value={row.quantity === 0 ? "" : String(row.quantity)}
          onChangeText={(text) => {
            // Digits only, live-capped at the pool so a row can never claim
            // more than the asset owns; the cross-row sum check lives in the
            // parent. A cleared field parks the row at 0 (rendered empty) so
            // the next keystroke starts a fresh number — snapping straight
            // back to a digit would make erase-then-type concatenate onto it.
            const digits = text.replace(/[^0-9]/g, "");
            if (!digits) {
              onSetQuantity(row.rowId, 0);
              return;
            }
            onSetQuantity(
              row.rowId,
              Math.min(parseInt(digits, 10), totalQuantity)
            );
          }}
          // Focusing selects the pre-filled value so the first keystroke
          // replaces it rather than appending — placing a portion is the
          // common case, so typing a new number must not concatenate onto
          // the default (full-pool) seed.
          selectTextOnFocus
          keyboardType="number-pad"
          returnKeyType="done"
          accessibilityLabel={`Quantity at ${row.locationName}`}
        />
        <TouchableOpacity
          style={[
            styles.stepButton,
            row.quantity >= totalQuantity && styles.stepButtonDisabled,
          ]}
          onPress={() => onStep(row, 1)}
          disabled={row.quantity >= totalQuantity}
          activeOpacity={0.7}
          accessibilityLabel={`Increase ${row.locationName} quantity`}
          accessibilityRole="button"
          accessibilityState={{ disabled: row.quantity >= totalQuantity }}
        >
          <Ionicons name="add" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={styles.rowUnit}>{unitLabel}</Text>
      </View>
    </View>
  );
}

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
  scroll: {
    flex: 1,
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  subtitle: {
    fontSize: fontSize.lg,
    color: colors.foregroundSecondary,
    lineHeight: 22,
  },
  kitBlock: {
    gap: spacing.xs,
  },
  kitBlockLabel: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  kitRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  kitRowName: {
    flex: 1,
    fontSize: fontSize.base,
    color: colors.foreground,
  },
  kitRowMeta: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  row: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.sm,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadows.sm,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  rowName: {
    flex: 1,
    fontSize: fontSize.lg,
    fontWeight: "600",
    color: colors.foreground,
  },
  removeButton: {
    padding: spacing.xs,
  },
  quantityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  stepButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.gray300,
    justifyContent: "center",
    alignItems: "center",
  },
  stepButtonDisabled: {
    opacity: 0.4,
  },
  input: {
    flex: 1,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: fontSize.lg,
    color: colors.foreground,
    textAlign: "center",
  },
  rowUnit: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  emptyHint: {
    fontSize: fontSize.sm,
    color: colors.foregroundSecondary,
    textAlign: "center",
    lineHeight: 18,
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.lg,
    paddingVertical: 12,
    ...shadows.sm,
  },
  addButtonDisabled: {
    opacity: 0.5,
  },
  addButtonText: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
  },
  duplicateHint: {
    fontSize: fontSize.sm,
    color: colors.foregroundSecondary,
    textAlign: "center",
  },
  meter: {
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  meterLine: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  meterLabel: {
    fontSize: fontSize.base,
    color: colors.foreground,
  },
  meterValue: {
    fontSize: fontSize.base,
    color: colors.foreground,
    fontVariant: ["tabular-nums"],
  },
  meterKitLabel: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  meterKitValue: {
    fontSize: fontSize.sm,
    color: colors.muted,
    fontVariant: ["tabular-nums"],
  },
  meterMutedLabel: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  meterMutedValue: {
    fontSize: fontSize.sm,
    color: colors.muted,
    fontVariant: ["tabular-nums"],
  },
  meterErrorLabel: {
    fontSize: fontSize.sm,
    color: colors.error,
  },
  meterErrorValue: {
    fontSize: fontSize.sm,
    color: colors.error,
    fontVariant: ["tabular-nums"],
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: borderRadius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.warningText,
    lineHeight: 18,
  },
  confirmPrimary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingVertical: 14,
    marginTop: spacing.sm,
    gap: spacing.sm,
    ...shadows.sm,
  },
  confirmDisabled: {
    opacity: 0.5,
  },
  confirmText: {
    color: colors.primaryForeground,
    fontSize: fontSize.lg,
    fontWeight: "600",
  },
  cancelButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.lg,
    paddingVertical: 14,
    ...shadows.sm,
  },
  cancelText: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: "600",
  },
}));
