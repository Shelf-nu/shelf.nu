/**
 * Scan feedback module: plays a short bleep and a haptic burst on a successful
 * scan. Respects the user preference stored in AsyncStorage, which Settings
 * toggles.
 *
 * @see {@link file://./scan-sound.test.ts}
 */
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
} from "expo-audio";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SOUND_KEY = "shelf_scan_sound_enabled";

let soundObject: AudioPlayer | null = null;
let isEnabled = true; // default ON
let loaded = false;
/** The load in flight, shared so concurrent callers create one player. */
let loading: Promise<void> | null = null;

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
function ensureLoaded(): Promise<void> {
  if (loaded && soundObject) return Promise.resolve();
  loading ??= loadSound().finally(() => {
    loading = null;
  });
  return loading;
}

async function loadSound(): Promise<void> {
  try {
    // The bleep plays with the ringer silenced and mixes with other audio,
    // so music or a call on the device is never paused or lowered by a scan.
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: "mixWithOthers",
    });

    const player = createAudioPlayer(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("@/assets/sounds/scan-bleep.wav")
    );
    player.volume = 0.6;
    soundObject = player;
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
    // Held locally: an unload while the seek is pending clears soundObject.
    const player = soundObject;
    if (player) {
      // A seek on a player that is still loading can reject; play anyway, the
      // player starts once the sound is ready.
      await player.seekTo(0).catch(() => {});
      player.play();
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

/**
 * Releases the player. Waits for a load that is still running first, so that
 * load cannot set the player again after it was released.
 */
export async function unloadScanSound(): Promise<void> {
  if (loading) await loading;
  if (soundObject) {
    soundObject.remove();
    soundObject = null;
    loaded = false;
  }
}
