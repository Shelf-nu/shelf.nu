/**
 * A counter that moves on every full server switch.
 *
 * A full switch sweeps every server-scoped key off the device (audit scan
 * drafts included, see `clearServerScopedState` in `./active-server.ts`).
 * Work started for the outgoing server, such as a draft save waiting its turn
 * or a scan send that settles after the switch began, must not write a draft
 * back after that sweep. Writers read the counter when they start and drop the
 * write when it has moved. A sign-out or a credentials-only change keeps the
 * drafts, so neither moves it.
 *
 * Imports nothing, so `./active-server.ts` and the draft modules can both use
 * it without forming a require cycle.
 *
 * @see {@link file://./server-scope.test.ts}
 */

let switches = 0;

/** The server-switch counter. */
export const serverScope = {
  /** The current count; compare a value read earlier to see if it moved. */
  current: (): number => switches,
  /** Moves the counter. Called first thing in a full server switch. */
  bump: (): void => {
    switches += 1;
  },
};
