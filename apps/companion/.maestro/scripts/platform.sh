#!/usr/bin/env bash
#############################################################################
# Platform helpers for the Maestro runners.
#
# Maestro flows are platform-agnostic, but everything around them — booting a
# device, clearing the stored session between runs, capturing logs, toggling
# dark mode — is not. Each of those lives here behind one name so `run-all.sh`
# and `run-suite.sh` read the same on either platform.
#
# Select with PLATFORM=ios (default) or PLATFORM=android. Choose the device
# with IOS_SIMULATOR (name or UDID) or ANDROID_AVD (AVD name); a chosen device
# is always the one used. Left unset, an already-running simulator or Android
# device is used, else "iPhone 15 Pro Max" or the first AVD boots.
# ANDROID_APP_ID overrides the Android package the flows drive.
#
# Source this file; it defines functions and sets MAESTRO_DEVICE_FLAGS.
#############################################################################

PLATFORM="${PLATFORM:-ios}"
IOS_SIMULATOR_CHOSEN="${IOS_SIMULATOR:+1}"
IOS_SIMULATOR="${IOS_SIMULATOR:-iPhone 15 Pro Max}"
ANDROID_AVD="${ANDROID_AVD:-}"
# `app.json` → `android.package`. The Android build has no Debug-only suffix,
# unlike the iOS dev client that config.yaml names.
ANDROID_APP_ID="${ANDROID_APP_ID:-com.shelf.companion}"
# How long a booting device may take before the run gives up.
DEVICE_BOOT_TIMEOUT=180

if [ "$PLATFORM" != "ios" ] && [ "$PLATFORM" != "android" ]; then
  echo "✗ PLATFORM must be 'ios' or 'android' (got: $PLATFORM)" >&2
  exit 1
fi

ANDROID_SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$ANDROID_SDK/platform-tools/adb"
EMULATOR="$ANDROID_SDK/emulator/emulator"

# The app id the flows target on this platform, so `pm clear` wipes the right
# package. On iOS it is config.yaml's appId, which every flow header repeats.
maestro_app_id() {
  if [ "$PLATFORM" = "android" ]; then
    echo "$ANDROID_APP_ID"
    return
  fi
  local config="$1/config.yaml"
  [ -f "$config" ] && sed -n 's/^appId:[[:space:]]*//p' "$config" | head -1
}

# Print the directory the runner reads flows from. On iOS that is the .maestro
# directory itself. On Android it is a throwaway copy whose `appId:` lines name
# ANDROID_APP_ID, because each flow header pins the iOS dev-client id and
# Maestro launches whatever that header says. The copy keeps the directory
# layout, so relative `runFlow` paths still resolve. Remove it with
# platform_cleanup_flows.
platform_prepare_flows() {
  local maestro_dir="$1"
  if [ "$PLATFORM" = "ios" ]; then
    echo "$maestro_dir"
    return
  fi
  local staged
  staged=$(mktemp -d "${TMPDIR:-/tmp}/maestro-android.XXXXXX") || return 1
  cp -R "$maestro_dir/flows" "$maestro_dir/shared" "$maestro_dir/config.yaml" "$staged/" || return 1
  find "$staged" -name '*.yaml' -exec sed -i.orig "s/^appId:.*/appId: $ANDROID_APP_ID/" {} + || return 1
  find "$staged" -name '*.yaml.orig' -delete
  echo "$staged"
}

platform_cleanup_flows() {
  local flows_root="$1" maestro_dir="$2"
  if [ -n "$flows_root" ] && [ "$flows_root" != "$maestro_dir" ]; then
    rm -rf "$flows_root"
  fi
}

# Human-readable device name for the run report.
platform_label() {
  if [ "$PLATFORM" = "ios" ]; then
    if [ -n "$IOS_SIMULATOR_CHOSEN" ]; then
      echo "iOS Simulator ($IOS_SIMULATOR)"
    else
      echo "iOS Simulator (${IOS_UDID:-booted, else $IOS_SIMULATOR})"
    fi
  else
    echo "Android Emulator (${ANDROID_AVD:-${ANDROID_SERIAL:-first connected device}})"
  fi
}

# UDID of the simulator IOS_SIMULATOR names (or IOS_SIMULATOR itself when it is
# already a UDID). A booted match wins over a shut-down one of the same name.
ios_resolve_udid() {
  local devices
  devices=$(xcrun simctl list devices available 2>/dev/null) || return 1
  local matches
  matches=$(printf '%s\n' "$devices" \
    | grep -F -e "    $IOS_SIMULATOR (" -e "($IOS_SIMULATOR)")
  { printf '%s\n' "$matches" | grep "(Booted)"; printf '%s\n' "$matches"; } \
    | sed -n 's/.*(\([0-9A-Fa-f-]\{36\}\)).*/\1/p' | head -1
}

# Serial of the running emulator whose AVD name is $1, if any.
android_serial_for_avd() {
  local avd="$1" serial
  for serial in $("$ADB" devices | sed -n 's/^\(emulator-[0-9]*\)[[:space:]]*device$/\1/p'); do
    if [ "$("$ADB" -s "$serial" emu avd name 2>/dev/null | head -1 | tr -d '\r')" = "$avd" ]; then
      echo "$serial"
      return
    fi
  done
}

# Boot the requested device if it is not running, then export
# MAESTRO_DEVICE_FLAGS so every `maestro test` call targets it explicitly, and
# pin every later simctl / adb call in this file to the same device. Without
# this, a Mac with several simulators or emulators up lets each tool pick its
# own.
platform_ensure_device() {
  if [ "$PLATFORM" = "ios" ]; then
    IOS_UDID=""
    if [ -z "$IOS_SIMULATOR_CHOSEN" ]; then
      IOS_UDID=$(xcrun simctl list devices booted 2>/dev/null \
        | sed -n 's/.*(\([0-9A-Fa-f-]\{36\}\)) (Booted).*/\1/p' | head -1 || true)
    fi
    [ -n "$IOS_UDID" ] || IOS_UDID=$(ios_resolve_udid || true)
    if [ -z "$IOS_UDID" ]; then
      echo "✗ No available simulator named '$IOS_SIMULATOR'. Set IOS_SIMULATOR to a name or UDID from 'xcrun simctl list devices'." >&2
      exit 1
    fi
    local booted
    booted=$(xcrun simctl list devices booted 2>/dev/null || true)
    if [[ "$booted" != *"$IOS_UDID"* ]]; then
      echo "  Booting simulator: $IOS_SIMULATOR ($IOS_UDID)..."
      if ! xcrun simctl boot "$IOS_UDID"; then
        echo "✗ Could not boot simulator $IOS_UDID" >&2
        exit 1
      fi
      if ! xcrun simctl bootstatus "$IOS_UDID" >/dev/null; then
        echo "✗ Simulator $IOS_UDID did not finish booting" >&2
        exit 1
      fi
    fi
    MAESTRO_DEVICE_FLAGS=(--device "$IOS_UDID")
    return
  fi

  if [ ! -x "$ADB" ]; then
    echo "✗ adb not found at $ADB — set ANDROID_HOME" >&2
    exit 1
  fi

  local serial=""
  if [ -n "$ANDROID_AVD" ]; then
    serial=$(android_serial_for_avd "$ANDROID_AVD" || true)
  else
    serial=$("$ADB" devices | sed -n '2s/[[:space:]].*//p' || true)
  fi

  if [ -z "$serial" ]; then
    if [ ! -x "$EMULATOR" ]; then
      echo "✗ Android emulator not found at $EMULATOR — set ANDROID_HOME" >&2
      exit 1
    fi
    if [ -z "$ANDROID_AVD" ]; then
      ANDROID_AVD=$("$EMULATOR" -list-avds 2>/dev/null | head -1)
    fi
    if [ -z "$ANDROID_AVD" ]; then
      echo "✗ No Android emulator running and no AVD to boot." >&2
      echo "  Create one in Android Studio, or set ANDROID_AVD." >&2
      exit 1
    fi

    echo "  Booting emulator: $ANDROID_AVD..."
    local launch_log
    launch_log=$(mktemp "${TMPDIR:-/tmp}/emulator-launch.XXXXXX")
    nohup "$EMULATOR" -avd "$ANDROID_AVD" >"$launch_log" 2>&1 &
    local emulator_pid=$!

    # Poll for the new emulator's serial on the same deadline as the boot
    # wait below, and stop early if the emulator process exits.
    local waited=0
    until serial=$(android_serial_for_avd "$ANDROID_AVD" || true) && [ -n "$serial" ]; do
      if ! kill -0 "$emulator_pid" 2>/dev/null; then
        echo "✗ Emulator exited during startup. Last output:" >&2
        tail -20 "$launch_log" >&2
        exit 1
      fi
      if [ "$waited" -ge "$DEVICE_BOOT_TIMEOUT" ]; then
        echo "✗ Emulator $ANDROID_AVD did not appear in adb within ${DEVICE_BOOT_TIMEOUT}s. Last output:" >&2
        tail -20 "$launch_log" >&2
        exit 1
      fi
      sleep 3
      waited=$((waited + 3))
    done
  fi

  # adb honours ANDROID_SERIAL, so every later "$ADB" call hits this device.
  export ANDROID_SERIAL="$serial"

  # A connected device can still be booting; installing or driving the app
  # before the launcher is up fails in ways that look like flow bugs.
  local boot_waited=0
  until [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
    sleep 3
    boot_waited=$((boot_waited + 3))
    if [ "$boot_waited" -ge "$DEVICE_BOOT_TIMEOUT" ]; then
      echo "✗ Emulator $serial did not finish booting within ${DEVICE_BOOT_TIMEOUT}s" >&2
      exit 1
    fi
  done

  MAESTRO_DEVICE_FLAGS=(--device "$serial")
}

# Clear the stored auth session so a run always starts logged out.
# `clearState` in a flow only clears AsyncStorage, not the platform keystore
# that SecureStore actually writes the tokens to.
platform_reset_credentials() {
  local app_id="$1"
  if [ "$PLATFORM" = "ios" ]; then
    xcrun simctl keychain "$IOS_UDID" reset 2>/dev/null || true
    echo "✓ Keychain reset (SecureStore cleared)"
  else
    if [ -n "$app_id" ]; then
      "$ADB" shell pm clear "$app_id" >/dev/null 2>&1 || true
      echo "✓ App data cleared for $app_id (SecureStore cleared)"
    else
      echo "⚠ No app id — stored session left in place"
    fi
  fi
}

# Stream device logs to $1 in the background; sets PLATFORM_LOG_PID.
platform_start_log_capture() {
  local log_file="$1"
  if [ "$PLATFORM" = "ios" ]; then
    xcrun simctl spawn "$IOS_UDID" log stream --level=debug \
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

# Switch the OS between light and dark for the dark-mode suite. Returns
# non-zero when the device refuses, so callers never run the dark-mode flows
# against the wrong appearance.
platform_set_appearance() {
  local mode="$1" # dark | light
  if [ "$PLATFORM" = "ios" ]; then
    if ! xcrun simctl ui "$IOS_UDID" appearance "$mode"; then
      echo "✗ Could not set the simulator to $mode mode" >&2
      return 1
    fi
  else
    local night="no"
    [ "$mode" = "dark" ] && night="yes"
    if ! "$ADB" shell cmd uimode night "$night" >/dev/null; then
      echo "✗ Could not set the emulator to $mode mode" >&2
      return 1
    fi
  fi
}
