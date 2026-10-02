/**
 * Full-screen image viewer
 *
 * Shows one image as large as the screen allows, at its own aspect ratio, over
 * a black backdrop: audit evidence photos (so a capture stamp in the corner is
 * readable), an asset's image and a kit's image. A tap anywhere, the close
 * button or Android's back gesture closes it.
 *
 * It is a React Native `Modal`. Inside another modal (an evidence sheet),
 * render it within that modal's tree: iOS presents a modal only from the one
 * already on screen, so a sibling modal never appears.
 */
import {
  Modal,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type FullScreenImageViewerProps = {
  /** The full-size image to show; null keeps the viewer closed. */
  uri: string | null;
  /** Called by the close button, a tap on the image and Android back. */
  onClose: () => void;
  /** What the image shows, for screen readers. */
  accessibilityLabel?: string;
};

/**
 * Opens `uri` full-screen while it is set.
 *
 * @param props - See {@link FullScreenImageViewerProps}
 */
export function FullScreenImageViewer({
  uri,
  onClose,
  accessibilityLabel = "Photo",
}: FullScreenImageViewerProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={uri !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* The modal scope wraps both children: VoiceOver ignores the siblings
          of a view marked modal, which would hide the close button. */}
      <View style={styles.root} accessibilityViewIsModal>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="image"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint="Tap to close"
        >
          {uri ? (
            <Image
              source={{ uri }}
              style={styles.image}
              contentFit="contain"
              cachePolicy="memory-disk"
            />
          ) : null}
        </Pressable>
        <TouchableOpacity
          style={[
            styles.closeButton,
            { top: insets.top + 12, right: insets.right + 16 },
          ]}
          onPress={onClose}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Close image viewer"
        >
          <Ionicons name="close" size={28} color="#fff" />
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "#000",
    justifyContent: "center",
    alignItems: "center",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  closeButton: {
    position: "absolute",
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
});
