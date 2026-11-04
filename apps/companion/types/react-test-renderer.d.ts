/**
 * The part of `react-test-renderer` the companion's hook tests use.
 *
 * Declared here rather than installed from `@types/react-test-renderer`: that
 * package depends on the newest `@types/react`, and a second copy of the React
 * types next to the monorepo's breaks the webapp typecheck.
 *
 * @see {@link file://./../hooks/use-discard-guard.test.ts}
 */
declare module "react-test-renderer" {
  import type { ReactElement } from "react";

  /** A mounted test tree. */
  export type ReactTestRenderer = {
    /** Re-renders the tree with a new root element. */
    update(element: ReactElement): void;
    /** Unmounts the tree. */
    unmount(): void;
  };

  /** Mounts `element` in a test tree. */
  export function create(element: ReactElement): ReactTestRenderer;
}
