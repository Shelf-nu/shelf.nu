#!/usr/bin/env bash
#############################################################################
# Platform helpers for the Maestro runners.
#
# Maestro flows are platform-agnostic, but everything around them — booting a
# device, clearing the stored session between runs, capturing logs, toggling
# dark mode — is not. Each of those lives here behind one name so `run-all.sh`
# and `run-suite.sh` read the same on either platform.
#
# Select with PLATFORM=ios (default) or PLATFORM=android. Override the device
# with IOS_SIMULATOR / ANDROID_AVD.
#
# Source this file; it defines functions and sets MAESTRO_DEVICE_FLAGS.
#############################################################################

PLATFORM="${PLATFORM:-ios}"
IOS_SIMULATOR="${IOS_SIMULATOR:-iPhone 15 Pro Max}"
ANDROID_AVD="${ANDROID_AVD:-}"

if [ "$PLATFORM" != "ios" ] && [ "$PLATFORM" != "android" ]; then
  echo "✗ PLATFORM must be 'ios' or 'android' (got: $PLATFORM)" >&2
  exit 1
fi

ANDROID_SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$ANDROID_SDK/platform-tools/adb"
EMULATOR="$ANDROID_SDK/emulator/emulator"

# The app id the flows target, so `pm clear` wipes the right package. Read from
# config.yaml rather than duplicated here — the dev launcher and the store build
# use different ids and the flows follow config.yaml.
maestro_app_id() {
  local config="$1/config.yaml"
  [ -f "$config" ] && sed -n 's/^appId:[[:space:]]*//p' "$config" | head -1
}

# Human-readable device name for the run report.
platform_label() {
  if [ "$PLATFORM" = "ios" ]; then
    echo "iOS Simulator ($IOS_SIMULATOR)"
  else
    echo "Android Emulator (${ANDROID_AVD:-$($ADB devices | sed -n '2s/\t.*//p')})"
  fi
}

# Boot a device if none is running, then export MAESTRO_DEVICE_FLAGS so every
# `maestro test` call targets it explicitly. Without this, a Mac with both an
# iOS simulator and an Android emulator up lets Maestro pick either one.
platform_ensure_device() {
  if [ "$PLATFORM" = "ios" ]; then
    local booted
    booted=$(xcrun simctl list devices booted 2>/dev/null | grep -c "Booted" || true)
    if [ "$booted" -eq 0 ]; then
      echo "  Booting simulator: $IOS_SIMULATOR..."
      xcrun simctl boot "$IOS_SIMULATOR" 2>/dev/null || true
      sleep 5
    fi
    local udid
    udid=$(xcrun simctl list devices booted -j 2>/dev/null \
      | sed -n 's/.*"udid" : "\([^"]*\)".*/\1/p' | head -1)
    MAESTRO_DEVICE_FLAGS=(--device "$udid")
    return
  fi

  if [ ! -x "$ADB" ]; then
    echo "✗ adb not found at $ADB — set ANDROID_HOME" >&2
    exit 1
  fi

  if [ -z "$("$ADB" devices | sed -n '2p')" ]; then
    if [ -z "$ANDROID_AVD" ]; then
      ANDROID_AVD=$("$EMULATOR" -list-avds 2>/dev/null | head -1)
    fi
    if [ -z "$ANDROID_AVD" ]; then
      echo "✗ No Android emulator running and no AVD to boot." >&2
      echo "  Create one in Android Studio, or set ANDROID_AVD." >&2
      exit 1
    fi
    echo "  Booting emulator: $ANDROID_AVD..."
    nohup "$EMULATOR" -avd "$ANDROID_AVD" >/dev/null 2>&1 &
  fi

  "$ADB" wait-for-device
  # `wait-for-device` returns as soon as adb can talk to the device, which is
  # well before the launcher is up; installing or driving the app before then
  # fails in ways that look like flow bugs.
  local waited=0
  until [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
    sleep 3
    waited=$((waited + 3))
    if [ "$waited" -ge 180 ]; then
      echo "✗ Emulator did not finish booting within 180s" >&2
      exit 1
    fi
  done

  MAESTRO_DEVICE_FLAGS=(--device "$("$ADB" devices | sed -n '2s/\t.*//p')")
}

# Clear the stored auth session so a run always starts logged out.
# `clearState` in a flow only clears AsyncStorage, not the platform keystore
# that SecureStore actually writes the tokens to.
platform_reset_credentials() {
  local app_id="$1"
  if [ "$PLATFORM" = "ios" ]; then
    xcrun simctl keychain booted reset 2>/dev/null || true
    echo "✓ Keychain reset (SecureStore cleared)"
  else
    if [ -n "$app_id" ]; then
      "$ADB" shell pm clear "$app_id" >/dev/null 2>&1 || true
      echo "✓ App data cleared for $app_id (SecureStore cleared)"
    else
      echo "⚠ No appId in config.yaml — stored session left in place"
    fi
  fi
}

# Stream device logs to $1 in the background; sets PLATFORM_LOG_PID.
platform_start_log_capture() {
  local log_file="$1"
  if [ "$PLATFORM" = "ios" ]; then
    xcrun simctl spawn booted log stream --level=debug \
      --predicate 'processImagePath CONTAINS "Shelf"' > "$log_file" 2>&1 &
  else
    "$ADB" logcat -c 2>/dev/null || true
    "$ADB" logcat > "$log_file" 2>&1 &
  fi
  PLATFORM_LOG_PID=$!
}

platform_stop_log_capture() {
  [ -n "${PLATFORM_LOG_PID:-}" ] && kill "$PLATFORM_LOG_PID" 2>/dev/null || true
}

# Switch the OS between light and dark for the dark-mode suite.
platform_set_appearance() {
  local mode="$1" # dark | light
  if [ "$PLATFORM" = "ios" ]; then
    xcrun simctl ui booted appearance "$mode" 2>/dev/null || true
  else
    local night="no"
    [ "$mode" = "dark" ] && night="yes"
    "$ADB" shell cmd uimode night "$night" >/dev/null 2>&1 || true
  fi
}
