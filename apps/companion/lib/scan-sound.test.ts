/**
 * Tests for the scan bleep's player lifecycle: one player however many scans
 * arrive while it loads, playback even when rewinding fails, and no player
 * left behind by a release that races a load.
 *
 * @see {@link file://./scan-sound.ts}
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { before, beforeEach, describe, it, mock } from "node:test";

type FakePlayer = {
  volume: number;
  seekTo: (seconds: number) => Promise<void>;
  play: () => void;
  remove: () => void;
  plays: number;
  removed: boolean;
};

/** Every player the module created, in order. */
const players: FakePlayer[] = [];
/** Makes the next players' `seekTo` reject, as on a player still loading. */
let seekRejects = false;
/** Releases a pending `setAudioModeAsync`; null when it resolves at once. */
let releaseAudioMode: (() => void) | null = null;
let holdAudioMode = false;

// why: expo-audio is a native module. The fake records each player so a test
// can count them and see whether `play` ran.
mock.module("expo-audio", {
  namedExports: {
    setAudioModeAsync: () =>
      holdAudioMode
        ? new Promise<void>((resolve) => {
            releaseAudioMode = resolve;
          })
        : Promise.resolve(),
    createAudioPlayer: () => {
      const player: FakePlayer = {
        volume: 1,
        plays: 0,
        removed: false,
        seekTo: () =>
          seekRejects
            ? Promise.reject(new Error("not loaded"))
            : Promise.resolve(),
        play: () => {
          player.plays += 1;
        },
        remove: () => {
          player.removed = true;
        },
      };
      players.push(player);
      return player;
    },
  },
});

// why: haptics are a native module; the bleep tests do not look at them.
mock.module("expo-haptics", {
  namedExports: {
    impactAsync: () => Promise.resolve(),
    ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  },
});

// why: AsyncStorage is a native module; an empty store means "sound on".
mock.module("@react-native-async-storage/async-storage", {
  defaultExport: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(),
  },
});

// why: the bleep is a bundled .wav that only Metro can load.
mock.module(
  pathToFileURL(join(__dirname, "../assets/sounds/scan-bleep.wav")).href,
  { defaultExport: 1 }
);

let scanSound: typeof import("./scan-sound");

before(async () => {
  scanSound = await import("./scan-sound");
});

beforeEach(async () => {
  await scanSound.unloadScanSound();
  players.length = 0;
  seekRejects = false;
  holdAudioMode = false;
  releaseAudioMode = null;
});

describe("scan sound", () => {
  it("creates one player for scans that arrive while it loads", async () => {
    await Promise.all([
      scanSound.playScanSound(),
      scanSound.playScanSound(),
      scanSound.playScanSound(),
    ]);

    assert.equal(players.length, 1);
    assert.equal(players[0].plays, 3);
  });

  it("still plays when rewinding the player fails", async () => {
    seekRejects = true;

    await scanSound.playScanSound();

    assert.equal(players.length, 1);
    assert.equal(players[0].plays, 1);
  });

  it("releases a player whose load was still running", async () => {
    holdAudioMode = true;
    const preload = scanSound.preloadScanSound();
    // Let the load reach the held audio-mode call.
    await new Promise((resolve) => setImmediate(resolve));

    const unload = scanSound.unloadScanSound();
    releaseAudioMode?.();
    await Promise.all([preload, unload]);

    assert.equal(players.length, 1);
    assert.equal(players[0].removed, true);
  });
});
