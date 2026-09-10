/**
 * Code Section
 *
 * Renders the code a workspace labels a code-bearing entity with, and lets the
 * reader switch to any other code that entity carries. Shared by the asset and
 * kit detail screens so the two never drift.
 *
 * Which code leads is the SERVER's decision, arriving as `displayCode` — a
 * per-asset override first, then the workspace's code preference, then the
 * Shelf QR. The app deliberately does not re-derive it: it never receives the
 * workspace preference, and resolving server-side is what lets an installed
 * build follow a preference change without an app release.
 *
 * Symbology maps and bwip-js options are kept identical to the web renderer
 * (`apps/webapp/app/components/barcode/barcode-display.tsx`) so the same value
 * produces the same bars in both apps — a label printed from the web must scan
 * against what this screen shows.
 *
 * @see {@link file://./../../../webapp/app/modules/barcode/display.ts} `resolveDisplayCode`
 */
import { memo, useMemo, useState } from "react";
import { View, Text, Pressable, Platform, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SvgXml } from "react-native-svg";
// Imported statically, not lazily: this package declares only an `import`
// condition in its `exports` map, so a `require()` matches nothing on iOS and
// Metro falls back to file-based resolution with a warning. A static ESM
// import is the only form the package actually publishes.
import { toSVG } from "@bwip-js/react-native";
import type { ResolvedDisplayCode, BarcodeSymbology } from "@/lib/api";
import { buildCodeSelection } from "@/lib/display-codes";
import { createStyles } from "@/lib/create-styles";
import { useTheme } from "@/lib/theme-context";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { getApiBaseUrl } from "@/lib/api";

// Lazy-loaded, mirroring the QR library: neither renderer belongs in the
// initial bundle for screens that show no codes.
let QRCode: typeof import("react-native-qrcode-svg").default | null = null;
try {
  QRCode =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react-native-qrcode-svg").default ??
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react-native-qrcode-svg");
} catch {
  // Falls back to the placeholder glyph below.
}

/** bwip-js symbology ids. Same map the web renderer uses. */
const BWIP_FORMAT: Record<BarcodeSymbology, string> = {
  Code128: "code128",
  Code39: "code39",
  DataMatrix: "datamatrix",
  ExternalQR: "qrcode",
  EAN13: "ean13",
};

/** Codes that are 2D, and so take no bar height. */
const IS_TWO_DIMENSIONAL: Record<BarcodeSymbology, boolean> = {
  Code128: false,
  Code39: false,
  DataMatrix: true,
  ExternalQR: true,
  EAN13: false,
};

const CODE_SIZE = 180;

/**
 * Renders one linear or 2D barcode as SVG.
 *
 * bwip-js throws on a value the symbology cannot encode (letters in an EAN-13,
 * for instance). That is real, reachable data — a workspace can switch its
 * preference to a symbology its existing values do not satisfy — so the throw
 * is caught and reported in place rather than left to crash the screen.
 */
const BarcodeImage = memo(function BarcodeImage({
  symbology,
  value,
  styles,
}: {
  symbology: BarcodeSymbology;
  value: string;
  styles: ReturnType<typeof useCodeStyles>;
}) {
  const { colors } = useTheme();
  const svg = useMemo(() => {
    try {
      return toSVG({
        bcid: BWIP_FORMAT[symbology],
        text: value,
        scale: 3,
        ...(IS_TWO_DIMENSIONAL[symbology] ? {} : { height: 12 }),
        includetext: false,
        backgroundcolor: "ffffff",
        barcolor: "000000",
      }) as string;
    } catch {
      return null;
    }
  }, [symbology, value]);

  if (!svg) {
    return (
      <View style={styles.codePlaceholder}>
        <Ionicons name="barcode-outline" size={48} color={colors.mutedLight} />
        <Text style={styles.codeErrorText}>
          This value can&apos;t be drawn as {symbology}
        </Text>
      </View>
    );
  }

  // The bars stay black on white in BOTH themes, because that is what a
  // scanner needs — inverting a linear barcode is a common cause of failed
  // reads. In dark mode that would otherwise put a bare white slab on a dark
  // card, so the code sits on an explicit rounded plate: it reads as the
  // printed label it represents rather than as a rendering fault.
  return (
    <View
      style={styles.codePlate}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${symbology} barcode for ${value}`}
    >
      <SvgXml
        xml={svg}
        width={CODE_SIZE}
        height={IS_TWO_DIMENSIONAL[symbology] ? CODE_SIZE : CODE_SIZE * 0.55}
      />
    </View>
  );
});

interface CodeSectionProps {
  /** The server-resolved code to lead with. */
  displayCode?: ResolvedDisplayCode | null;
  /** Alternative codes on the entity; already add-on gated by the server. */
  barcodes?: { id: string; type: BarcodeSymbology; value: string }[];
  qrCodes?: { id: string }[];
}

/**
 * The detail screens' code block.
 *
 * @param props.displayCode - Server-resolved preferred code, or null/absent.
 * @param props.barcodes - The entity's alternative codes.
 * @param props.qrCodes - The entity's Shelf QR (at most one is rendered).
 * @returns The section, or null when the entity carries no code at all.
 */
export const CodeSection = memo(function CodeSection({
  displayCode,
  barcodes,
  qrCodes,
}: CodeSectionProps) {
  const styles = useCodeStyles();
  const { colors } = useTheme();

  // Every decision about WHICH code shows and how the section is worded lives
  // in `buildCodeSelection`, which is pure and unit-tested; this component only
  // draws the result and owns the switch between them.
  const { codes, leadKey, title, unmetPreference } = useMemo(
    () => buildCodeSelection({ displayCode, barcodes, qrCodes }),
    [displayCode, barcodes, qrCodes]
  );

  const [selectedKey, setSelectedKey] = useState<string | undefined>(undefined);
  const selected =
    codes.find((c) => c.key === selectedKey) ??
    codes.find((c) => c.key === leadKey) ??
    codes[0];

  if (!selected) return null;

  return (
    <View style={styles.sectionContainer}>
      <Text style={styles.sectionTitle}>{title}</Text>

      <View style={styles.codeCard}>
        {/* Selector first, mirroring the web preview, where a dropdown sits at
            the top of the card. Every code the entity carries is named here, so
            the Shelf QR is always one tap away and visibly present rather than
            hidden below the code it is being shown instead of. */}
        {codes.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.switcherRow}
            style={styles.switcherScroll}
          >
            {codes.map((code) => {
              const isActive = code.key === selected.key;
              return (
                <Pressable
                  key={code.key}
                  onPress={() => setSelectedKey(code.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={`Show ${code.label}`}
                  style={[
                    styles.switcherChip,
                    isActive && styles.switcherChipOn,
                  ]}
                >
                  <Text
                    style={[
                      styles.switcherText,
                      isActive && styles.switcherTextOn,
                    ]}
                    numberOfLines={1}
                  >
                    {code.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        <View style={styles.codeBody}>
          {selected.kind === "qr" ? (
            QRCode ? (
              <View
                accessible
                accessibilityRole="image"
                accessibilityLabel={`Shelf QR code for ${selected.value}`}
              >
                <QRCode
                  value={`${getApiBaseUrl()}/qr/${selected.qrId}`}
                  size={CODE_SIZE}
                  backgroundColor={colors.white}
                  color={colors.foreground}
                />
              </View>
            ) : (
              <View style={styles.codePlaceholder}>
                <Ionicons
                  name="qr-code-outline"
                  size={64}
                  color={colors.mutedLight}
                />
              </View>
            )
          ) : (
            <BarcodeImage
              symbology={selected.symbology}
              value={selected.value}
              styles={styles}
            />
          )}

          <Text style={styles.codeValueText} selectable numberOfLines={1}>
            {selected.value}
          </Text>

          {unmetPreference ? (
            // Say what happened rather than quietly showing a different code:
            // the reader is holding a label and needs to know why it disagrees.
            <Text style={styles.codeNoteText}>
              This workspace shows {unmetPreference}, which this item
              doesn&apos;t have yet.
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
});

const useCodeStyles = createStyles((colors, shadows) => ({
  sectionContainer: { paddingHorizontal: spacing.lg, marginTop: spacing.xl },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: "600" as const,
    color: colors.muted,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  codeCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden" as const,
    ...shadows.sm,
  },
  codeBody: {
    alignItems: "center" as const,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  switcherScroll: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexGrow: 0,
  },
  // Always literal white, never `colors.white` — that token is the dark card
  // surface in dark mode, and a barcode has to stay dark-on-light to scan.
  codePlate: {
    backgroundColor: "#FFFFFF",
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  codePlaceholder: {
    width: CODE_SIZE,
    height: CODE_SIZE,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  codeValueText: {
    fontSize: fontSize.xs,
    color: colors.mutedLight,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    textAlign: "center" as const,
  },
  codeErrorText: {
    marginTop: spacing.sm,
    fontSize: fontSize.sm,
    color: colors.muted,
    textAlign: "center" as const,
  },
  codeNoteText: {
    fontSize: fontSize.sm,
    color: colors.muted,
    textAlign: "center" as const,
  },
  switcherRow: {
    flexDirection: "row" as const,
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    alignItems: "center" as const,
  },
  switcherChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundTertiary,
  },
  switcherChipOn: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryBg,
  },
  switcherText: {
    fontSize: fontSize.xs,
    color: colors.muted,
    fontWeight: "500" as const,
  },
  switcherTextOn: {
    color: colors.primary,
    fontWeight: "600" as const,
  },
}));
