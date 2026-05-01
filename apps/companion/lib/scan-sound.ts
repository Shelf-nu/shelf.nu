/**
 * Scan feedback module — plays a short bleep + haptic burst on successful scan.
 * Respects user preference stored in AsyncStorage.
 * Can be toggled in Settings.
 */
import { Audio } from "expo-av";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SOUND_KEY = "shelf_scan_sound_enabled";

let soundObject: Audio.Sound | null = null;
let isEnabled = true; // default ON
let loaded = false;

/** Load persisted preference (call once on app start) */
export async function loadScanSoundPreference(): Promise<boolean> {
  try {
    const stored = await AsyncStorage.getItem(SOUND_KEY);
    if (stored === "false") {
      isEnabled = false;
    } else {
      isEnabled = true;
    }
  } catch {
    isEnabled = true;
  }
  return isEnabled;
}

/** Toggle and persist the preference */
export async function setScanSoundEnabled(enabled: boolean): Promise<void> {
  isEnabled = enabled;
  await AsyncStorage.setItem(SOUND_KEY, enabled ? "true" : "false");
}

/** Get current state */
export function isScanSoundEnabled(): boolean {
  return isEnabled;
}

/** Pre-load the sound for instant playback */
async function ensureLoaded(): Promise<void> {
  if (loaded && soundObject) return;
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
    });

    const { sound } = await Audio.Sound.createAsync(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("@/assets/sounds/scan-bleep.wav"),
      { shouldPlay: false, volume: 0.6 }
    );
    soundObject = sound;
    loaded = true;
  } catch {
    // Audio not available — haptics will still work
    loaded = false;
  }
}

/**
 * Play scan feedback if enabled: audio bleep + haptic triple-tap.
 * Call on successful scan.
 */
export async function playScanSound(): Promise<void> {
  if (!isEnabled) return;
  try {
    // Fire audio and haptic pattern in parallel
    const audioPromise = playAudio();
    const hapticPromise = playHapticPattern();
    await Promise.all([audioPromise, hapticPromise]);
  } catch {
    // Never crash on feedback failure
  }
}

async function playAudio(): Promise<void> {
  try {
    await ensureLoaded();
    if (soundObject) {
      await soundObject.setPositionAsync(0);
      await soundObject.playAsync();
    }
  } catch {
    // Silent degradation
  }
}

async function playHapticPattern(): Promise<void> {
  try {
    // Rapid triple-tap: Medium → Light → Heavy
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await delay(60);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await delay(60);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  } catch {
    // Silent degradation
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pre-load sound at app startup so first scan is instant */
export async function preloadScanSound(): Promise<void> {
  try {
    await loadScanSoundPreference();
    await ensureLoaded();
  } catch {
    // Silent — never block app startup
  }
}

/** Cleanup (call on app unmount if needed) */
export async function unloadScanSound(): Promise<void> {
  if (soundObject) {
    await soundObject.unloadAsync();
    soundObject = null;
    loaded = false;
  }
}
