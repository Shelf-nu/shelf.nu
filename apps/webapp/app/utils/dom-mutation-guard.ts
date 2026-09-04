/**
 * Keeps React's DOM commits from throwing when something outside React has
 * rewritten the nodes React owns.
 *
 * Chrome's built-in page translation (and extensions such as Google Translate
 * or Grammarly) replace text nodes with `<font>` wrappers and reparent nodes.
 * React keeps references to the original nodes, so its next commit calls
 * `parent.removeChild(node)` or `parent.insertBefore(node, reference)` with a
 * node that is no longer a child of `parent`. The browser throws
 * `NotFoundError`, React hands it to the nearest error boundary, and the whole
 * route is replaced by the "Oops, something went wrong" screen. On a
 * translated page this happens on the first placeholder swap in a Select,
 * the first conditional text node that toggles, or the first unmount.
 *
 * The guard wraps `Node.prototype.removeChild` and `Node.prototype.insertBefore`:
 *
 * - `removeChild` of a node that is not a child of the receiver returns the
 *   node without touching the DOM. The receiver already lacks that node where
 *   React expects it, so there is nothing to remove.
 * - `insertBefore` with a reference that is not a child of the receiver walks
 *   up from the reference to the nearest ancestor that IS a child and inserts
 *   before that ancestor (a reference that was moved into a wrapper). A
 *   reference that was detached from the document has no such ancestor and
 *   the node is appended.
 *
 * Calls that satisfy the DOM contract go straight to the native method, so
 * React's normal operation is unchanged. Install once, before hydration.
 *
 * @see {@link file://./../entry.client.tsx} — the install site
 * @see {@link file://./sentry-filters.ts} — drops the same `NotFoundError`
 *      shape from Sentry for browsers where the guard is not active
 */

type RemoveChild = Node["removeChild"];
type InsertBefore = Node["insertBefore"];

/** Native methods captured at install time, keyed by the patched prototype. */
const nativeMethods = new WeakMap<
  Node,
  { removeChild: RemoveChild; insertBefore: InsertBefore }
>();

const warned = new Set<string>();

/**
 * Logs one warning per method per page load. The warning is a diagnostic for
 * developers looking at a translated page in devtools, not an error: the
 * guard already recovered.
 */
function warnOnce(method: string, receiver: Node, node: Node) {
  if (warned.has(method)) {
    return;
  }
  warned.add(method);
  // eslint-disable-next-line no-console
  console.warn(
    `[dom-mutation-guard] ${method} was called with a node that is not a child of its receiver. Something outside React (page translation or a browser extension) rewrote the DOM; React's commit continued without it.`,
    { receiver, node }
  );
}

/** The global `Node.prototype`, or `null` where there is no DOM (SSR). */
function defaultProto(): Node | null {
  return typeof Node === "function" ? Node.prototype : null;
}

/**
 * Installs the guard on `proto` (defaults to the global `Node.prototype`).
 * Installing twice on the same prototype is a no-op.
 *
 * @param proto - The prototype whose `removeChild` / `insertBefore` to wrap;
 *   `null` installs nothing
 * @returns A function that restores the native methods (used by tests)
 */
export function installDomMutationGuard(
  proto: Node | null = defaultProto()
): () => void {
  if (!proto) {
    return () => {};
  }
  if (nativeMethods.has(proto)) {
    return () => uninstallDomMutationGuard(proto);
  }

  const nativeRemoveChild = proto.removeChild;
  const nativeInsertBefore = proto.insertBefore;
  nativeMethods.set(proto, {
    removeChild: nativeRemoveChild,
    insertBefore: nativeInsertBefore,
  });

  proto.removeChild = function guardedRemoveChild<T extends Node>(
    this: Node,
    child: T
  ): T {
    if (child.parentNode !== this) {
      warnOnce("removeChild", this, child);
      return child;
    }
    return nativeRemoveChild.call(this, child) as T;
  };

  proto.insertBefore = function guardedInsertBefore<T extends Node>(
    this: Node,
    node: T,
    reference: Node | null
  ): T {
    if (reference && reference.parentNode !== this) {
      warnOnce("insertBefore", this, reference);
      let anchor: Node | null = reference;
      while (anchor && anchor.parentNode !== this) {
        anchor = anchor.parentNode;
      }
      return nativeInsertBefore.call(this, node, anchor) as T;
    }
    return nativeInsertBefore.call(this, node, reference) as T;
  };

  return () => uninstallDomMutationGuard(proto);
}

/**
 * Restores the native methods on `proto`. No-op when the guard is not
 * installed there.
 */
export function uninstallDomMutationGuard(
  proto: Node | null = defaultProto()
): void {
  if (!proto) {
    return;
  }
  const native = nativeMethods.get(proto);
  if (!native) {
    return;
  }
  proto.removeChild = native.removeChild;
  proto.insertBefore = native.insertBefore;
  nativeMethods.delete(proto);
  warned.clear();
}

/** Whether the guard is currently installed on `proto`. */
export function isDomMutationGuardInstalled(
  proto: Node | null = defaultProto()
): boolean {
  return Boolean(proto && nativeMethods.has(proto));
}
