/**
 * Which account an audit scan queue belongs to, and what it may do while a
 * different account (or none) is signed in.
 *
 * The queue belongs to the first account seen signed in on the scan screen.
 * Its scans are always saved to that account's draft, so they stay
 * recoverable by their owner, but they are only sent to the server, and new
 * scans only added, while that same account is signed in. Another account
 * never saves into, adds to or submits someone else's queue.
 *
 * Pure on purpose (no React Native, Expo or `@/` imports) so `node:test` can
 * load it.
 *
 * @see {@link file://./scan-queue-owner.test.ts}
 * @see {@link file://../hooks/use-scan-queue.ts}
 */

/** What the queue may do for the account signed in now. */
export type QueueAccess = {
  /** The account the queue belongs to, or null while none is known. */
  owner: string | null;
  /** Saving the queue to the owner's draft is allowed. */
  maySave: boolean;
  /** Adding scans and sending them to the server is allowed. */
  mayUse: boolean;
};

/**
 * Resolves the queue's owner and what it may do.
 *
 * @param owner - The owner recorded so far, or null
 * @param signedIn - The account signed in now, or undefined
 * @returns The owner (adopting `signedIn` when none was recorded) and the
 *   allowed actions
 */
export function resolveQueueAccess(
  owner: string | null,
  signedIn: string | undefined
): QueueAccess {
  const resolved = owner ?? signedIn ?? null;
  return {
    owner: resolved,
    maySave: resolved !== null,
    mayUse: resolved !== null && signedIn === resolved,
  };
}

/** The queue's ownership rules, as the scan-queue hook applies them. */
export type QueueGate = {
  /**
   * Reports the account signed in now. The first account seen becomes the
   * owner and never changes.
   *
   * @param userId - The signed-in account, or undefined
   */
  observe: (userId: string | undefined) => void;
  /** The owner, or null while no account has been seen. */
  owner: () => string | null;
  /** Saving to the owner's draft is allowed (an owner is known). */
  maySave: () => boolean;
  /**
   * Adding a scan, or sending one, is allowed: the screen is open and the
   * owner is the account signed in now. Refused while nobody is signed in.
   */
  mayUse: () => boolean;
  /** The scan screen closed: sending stops. */
  stop: () => void;
  /** The scan screen opened (again). */
  start: () => void;
};

/**
 * Creates the ownership controller for one scan queue.
 *
 * @returns The gate, with no owner, nobody signed in, and started
 */
export function createQueueGate(): QueueGate {
  let owner: string | null = null;
  let signedIn: string | undefined;
  let stopped = false;
  return {
    observe(userId) {
      signedIn = userId;
      owner = resolveQueueAccess(owner, userId).owner;
    },
    owner: () => owner,
    maySave: () => owner !== null,
    mayUse: () => !stopped && resolveQueueAccess(owner, signedIn).mayUse,
    stop() {
      stopped = true;
    },
    start() {
      stopped = false;
    },
  };
}
