import { View, Animated } from "react-native";
import { createStyles } from "@/lib/create-styles";

const FRAME_SIZE = 240;

type ScanFrameProps = {
  scanLineAnim: Animated.Value;
  frameHighlight: "success" | "error" | null;
  showScanLine: boolean;
};

/**
 * Camera scan frame overlay with animated corners and scan line.
 * Corners flash green/red on scan result (Scandit/Scanbot pattern).
 */
export function ScanFrame({
  scanLineAnim,
  frameHighlight,
  showScanLine,
}: ScanFrameProps) {
  const styles = useStyles();

  const highlightColor = frameHighlight
    ? frameHighlight === "success"
      ? "#4CAF50"
      : "#F04438"
    : undefined;

  const scanLineTranslate = scanLineAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 220],
  });

  return (
    <View style={styles.scanFrame}>
      <View
        style={[
          styles.corner,
          styles.cornerTL,
          highlightColor && { borderColor: highlightColor },
        ]}
      />
      <View
        style={[
          styles.corner,
          styles.cornerTR,
          highlightColor && { borderColor: highlightColor },
        ]}
      />
      <View
        style={[
          styles.corner,
          styles.cornerBL,
          highlightColor && { borderColor: highlightColor },
        ]}
      />
      <View
        style={[
          styles.corner,
          styles.cornerBR,
          highlightColor && { borderColor: highlightColor },
        ]}
      />
      {showScanLine && (
        <Animated.View
          style={[
            styles.scanLine,
            { transform: [{ translateY: scanLineTranslate }] },
          ]}
        />
      )}
    </View>
  );
}

const useStyles = createStyles(() => ({
  scanFrame: {
    width: FRAME_SIZE,
    height: FRAME_SIZE,
    position: "relative",
  },
  corner: {
    position: "absolute",
    width: 30,
    height: 30,
    borderColor: "#FFFFFF",
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 6,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 6,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 6,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 6,
  },
  scanLine: {
    position: "absolute",
    left: 8,
    right: 8,
    height: 2,
    backgroundColor: "rgba(255,255,255,0.7)",
    borderRadius: 1,
    top: 8,
  },
}));
