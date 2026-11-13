/**
 * Bookkeeping for overlapping reads of one resource (the workspace context's
 * `/api/mobile/me`): which read is the latest, and which read owns the
 * loading state.
 *
 * Only the latest read applies its answer. A foreground read turns loading on,
 * and loading turns off only when the data that ends it has arrived: a
 * foreground read overtaken by a newer read hands loading to it, and the
 * newest read still running turns it off when it ends. A background read
 * never turns loading on, but ends it when it was handed over.
 *
 * @see lib/org-context.tsx
 */

/**
 * @param setLoading - Sets the loading state.
 * @returns `begin` to start a read, `isLatest` to ask whether a read may
 *   apply its answer, and `end` to finish a read on every path.
 */
export function createReadTracker(setLoading: (loading: boolean) => void) {
  let latest = 0;
  let owner: number | null = null;
  const running = new Set<number>();

  const release = () => {
    owner = null;
    setLoading(false);
  };

  return {
    /**
     * Starts a read.
     *
     * @param foreground - Whether the read shows loading.
     * @returns The read's id, for `isLatest` and `end`.
     */
    begin(foreground: boolean): number {
      const id = ++latest;
      running.add(id);
      if (foreground) {
        owner = id;
        setLoading(true);
      }
      return id;
    },

    /** Whether no newer read has started since this one. */
    isLatest(id: number): boolean {
      return id === latest;
    },

    /** Finishes a read, on success, failure or when overtaken. */
    end(id: number): void {
      running.delete(id);
      if (owner !== id) return;
      if (id !== latest && running.has(latest)) owner = latest;
      else release();
    },
  };
}
