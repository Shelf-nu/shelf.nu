/**
 * The part of `react-test-renderer` the companion's hook tests use.
 *
 * Declared here so the tests do not depend on `@types/react-test-renderer`,
 * which the companion does not declare and only gets through a dependency.
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
