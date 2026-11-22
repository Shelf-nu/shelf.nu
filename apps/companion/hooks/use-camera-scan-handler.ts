/**
 * useCameraScanHandler: a stable `onBarcodeScanned` for `CameraView`.
 *
 * The returned function keeps one identity for the life of the screen and is
 * never swapped for `undefined`, which on iOS would reconfigure the capture
 * session and switch the torch off (see `lib/camera-frame-gate.ts`). Whether a
 * frame is acted on is decided on each call from the latest `handle` and
 * `ignore`.
 *
 * @see {@link file://./../lib/camera-frame-gate.ts}
 * @see {@link file://./../app/(tabs)/scanner.tsx}
 * @see {@link file://./../app/(tabs)/audits/scan.tsx}
 */
import { useLayoutEffect, useRef, useState } from "react";
import { createFrameGate, type FrameGateState } from "@/lib/camera-frame-gate";

/**
 * Returns the frame callback to pass as `CameraView.onBarcodeScanned`.
 *
 * @param handle - The screen's scan handler. It keeps its own processing lock
 *   and cooldown; the gate only adds `ignore`.
 * @param ignore - True while camera frames must be dropped, e.g. while a View
 *   result card waits to be dismissed. Manual code entry calls `handle`
 *   directly and is not affected.
 * @returns A callback with a stable identity.
 */
export function useCameraScanHandler<E>(
  handle: (event: E) => unknown,
  ignore: boolean
): (event: E) => void {
  const latest = useRef<FrameGateState<E>>({ handle, ignore });

  // Layout effect: the ref is current before native props from the same
  // commit reach the camera, matching when a swapped prop would have landed.
  useLayoutEffect(() => {
    latest.current = { handle, ignore };
  }, [handle, ignore]);

  const [gate] = useState(() => createFrameGate(() => latest.current));
  return gate;
}
