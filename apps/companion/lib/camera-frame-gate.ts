/**
 * Camera frame gate: the one function a scanner hands to `CameraView` as
 * `onBarcodeScanned`.
 *
 * `onBarcodeScanned` must stay a function for as long as the camera is
 * mounted. On iOS, expo-camera reads a falsy handler as "barcode scanning off"
 * and removes its metadata and video outputs from the running capture session,
 * then adds them back when a handler returns. That reconfiguration switches the
 * torch off while the `enableTorch` prop still reads `true`, so the prop never
 * changes and the torch is never switched back on. Screens that need to ignore
 * frames (a lookup is running, a result card is up) answer that question here,
 * at call time, instead of swapping the prop.
 *
 * Pure and React-free so Node's test runner can cover it; the hook that keeps
 * the gate's identity stable lives in `hooks/use-camera-scan-handler.ts`.
 *
 * @see {@link file://./../hooks/use-camera-scan-handler.ts}
 * @see {@link file://./camera-frame-gate.test.ts}
 */

/** What the gate reads, fresh, on every frame. */
export type FrameGateState<E> = {
  /** True while frames must be dropped without reaching `handle`. */
  ignore: boolean;
  /** The screen's current scan handler. */
  handle: (event: E) => unknown;
};

/**
 * Builds the frame callback for `CameraView.onBarcodeScanned`.
 *
 * @param read - Returns the screen's latest state. Called once per frame, so a
 *   change of handler or of `ignore` takes effect without a new callback.
 * @returns A callback whose identity never needs to change.
 */
export function createFrameGate<E>(
  read: () => FrameGateState<E>
): (event: E) => void {
  return (event) => {
    const { ignore, handle } = read();
    if (ignore) return;
    void handle(event);
  };
}
