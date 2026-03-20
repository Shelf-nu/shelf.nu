import { useState } from "react";
import { Alert, Platform, ActionSheetIOS } from "react-native";
import * as Haptics from "expo-haptics";
import { api, type AssetDetail } from "@/lib/api";

// expo-image-picker requires native module — lazy-loaded to avoid crash
// if the dev client hasn't been rebuilt yet
let ImagePicker: typeof import("expo-image-picker") | null = null;
try {
  ImagePicker = require("expo-image-picker");
} catch {
  console.warn(
    "[useImageUpload] expo-image-picker native module not available. Rebuild dev client."
  );
}

interface UseImageUploadParams {
  assetId: string | undefined;
  orgId: string | undefined;
  fetchAsset: () => Promise<void>;
}

interface UseImageUploadReturn {
  isUploadingImage: boolean;
  pickAndUploadImage: (source: "camera" | "library") => Promise<void>;
  handleImagePress: () => void;
}

export function useImageUpload({
  assetId,
  orgId,
  fetchAsset,
}: UseImageUploadParams): UseImageUploadReturn {
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const pickAndUploadImage = async (source: "camera" | "library") => {
    if (!orgId || !assetId) return;

    if (!ImagePicker) {
      Alert.alert(
        "Rebuild Required",
        "Image picker requires a rebuilt dev client. Run: npx expo run:ios"
      );
      return;
    }

    // Request permissions
    if (source === "camera") {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          "Camera access is required to take photos."
        );
        return;
      }
    } else {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          "Photo library access is required to select images."
        );
        return;
      }
    }

    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ["images"],
            allowsEditing: true,
            aspect: [4, 3],
            quality: 0.8,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            allowsEditing: true,
            aspect: [4, 3],
            quality: 0.8,
          });

    if (result.canceled || !result.assets?.[0]) return;

    const pickedImage = result.assets[0];
    setIsUploadingImage(true);

    const { error: uploadErr } = await api.updateImage(
      orgId,
      assetId,
      pickedImage.uri,
      pickedImage.mimeType || "image/jpeg"
    );

    if (uploadErr) {
      Alert.alert("Upload Failed", uploadErr);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await fetchAsset();
    }

    setIsUploadingImage(false);
  };

  const handleImagePress = () => {
    if (isUploadingImage) return;

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Take Photo", "Choose from Library"],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) pickAndUploadImage("camera");
          else if (buttonIndex === 2) pickAndUploadImage("library");
        }
      );
    } else {
      Alert.alert("Update Image", "Choose a source", [
        { text: "Cancel", style: "cancel" },
        { text: "Take Photo", onPress: () => pickAndUploadImage("camera") },
        {
          text: "Choose from Library",
          onPress: () => pickAndUploadImage("library"),
        },
      ]);
    }
  };

  return { isUploadingImage, pickAndUploadImage, handleImagePress };
}
