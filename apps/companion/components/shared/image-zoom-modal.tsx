/**
 * ImageZoomModal: a photo shown full window on a dark backdrop, with a close
 * button in the top-right corner. Shared by the asset and kit detail screens
 * so both open their main image the same way.
 *
 * The close button and the image keep clear of the window's insets, each edge
 * its own: an iPhone Duo's status-bar rail (about 84 pt down the left or right
 * edge when open sideways) or a turned foldable's camera cutout never covers
 * them.
 *
 * @see {@link file://../../app/(tabs)/assets/[id].tsx} asset detail consumer
 * @see {@link file://../../app/(tabs)/assets/kits/[id].tsx} kit detail consumer
 * @see lib/use-safe-edges.ts for the inset maths
 */
import { Modal, TouchableOpacity, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { createStyles } from "@/lib/create-styles";
import { useOverlayEdges } from "@/lib/use-safe-edges";

/** Props for {@link ImageZoomModal}. */
type ImageZoomModalProps = {
  /** The image to show. */
  uri: string;
  /** Whether the viewer is open. */
  visible: boolean;
  /** Called by the close button and the Android back button. */
  onClose: () => void;
};

/**
 * Full-window image viewer.
 *
 * @param props - {@link ImageZoomModalProps}
 * @returns The viewer, rendered in a transparent `Modal`.
 */
export function ImageZoomModal({ uri, visible, onClose }: ImageZoomModalProps) {
  const styles = useStyles();
  const edges = useOverlayEdges();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.overlay,
          // The image fills the space between the side insets.
          { paddingLeft: edges.left, paddingRight: edges.right },
        ]}
        accessibilityViewIsModal={true}
      >
        <TouchableOpacity
          style={[styles.closeBtn, { top: edges.top, right: edges.right + 20 }]}
          onPress={onClose}
          accessibilityLabel="Close image viewer"
          accessibilityRole="button"
        >
          <Ionicons name="close" size={28} color="#fff" />
        </TouchableOpacity>
        <Image source={{ uri }} style={styles.image} contentFit="contain" />
      </View>
    </Modal>
  );
}

const useStyles = createStyles(() => ({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    justifyContent: "center",
    alignItems: "center",
  },
  // `top` and `right` come from the window's insets at render time.
  closeBtn: {
    position: "absolute",
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  // Sized against the overlay rather than a window size read when the styles
  // are built, so the image follows a rotation or a window resize.
  image: {
    width: "100%",
    height: "70%",
  },
}));
