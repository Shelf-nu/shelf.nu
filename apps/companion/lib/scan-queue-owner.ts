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
   * owner and never changes. Each time the owner is reported signed in, the
   * gate records the app's account counter at that moment: the owner's
   * session is the one that counter value stands for.
   *
   * @param userId - The signed-in account, or undefined
   * @param generation - The app's account counter now
   */
  observe: (userId: string | undefined, generation: number) => void;
  /** The owner, or null while no account has been seen. */
  owner: () => string | null;
  /** Saving to the owner's draft is allowed (an owner is known). */
  maySave: () => boolean;
  /**
   * Adding a scan, or sending one, is allowed: the owner is the account
   * signed in now. Refused while nobody or someone else is signed in.
   */
  mayUse: () => boolean;
  /**
   * The account counter recorded when the owner was last seen signed in, or
   * null before that.
   */
  ownerGeneration: () => number | null;
};

/**
 * Creates the ownership controller for one scan queue.
 *
 * @returns The gate, with no owner and nobody signed in
 */
export function createQueueGate(): QueueGate {
  let owner: string | null = null;
  let signedIn: string | undefined;
  let ownerGeneration: number | null = null;
  return {
    observe(userId, generation) {
      signedIn = userId;
      owner = resolveQueueAccess(owner, userId).owner;
      if (owner !== null && userId === owner) ownerGeneration = generation;
    },
    owner: () => owner,
    maySave: () => owner !== null,
    mayUse: () => resolveQueueAccess(owner, signedIn).mayUse,
    ownerGeneration: () => ownerGeneration,
  };
}

/** The slice of the app's account counter a drain needs. */
export type AccountCounter = { current: () => number };

/**
 * The check a drain runs before every send. A drain keeps sending after the
 * scan screen closes, so leaving the screen never strands queued scans, but
 * only within the owner's session: the session the gate last saw the owner
 * signed in. Any account change since (a sign-out, another person signing in,
 * a server switch) refuses every later send, for this drain and for any drain
 * started afterwards, even once the screen (and its view of the signed-in
 * user) is gone.
 *
 * @param gate - The queue's gate
 * @param account - The app's account counter
 * @returns The check for `drainScanQueue`'s `mayContinue`
 */
export function drainMayContinue(
  gate: QueueGate,
  account: AccountCounter
): () => boolean {
  return () => gate.mayUse() && account.current() === gate.ownerGeneration();
}

/**
 * Queues a scan first and records it on screen only once the queue took it:
 * the scan screen's rule for both a first scan and a recount. A refused scan
 * (nobody, or another account than the queue's owner, is signed in) is never
 * counted, listed or confirmed, and the operator is told instead.
 *
 * @param enqueue - The queue's `enqueueScan`
 * @param entry - The scan to queue
 * @param actions.record - Counts, lists and confirms the scan
 * @param actions.refuse - Tells the operator it was not recorded
 * @returns True when the scan was queued and recorded
 */
export function queueThenRecord<E>(
  enqueue: (entry: E) => boolean,
  entry: E,
  actions: { record: () => void; refuse: () => void }
): boolean {
  if (!enqueue(entry)) {
    actions.refuse();
    return false;
  }
  actions.record();
  return true;
}
