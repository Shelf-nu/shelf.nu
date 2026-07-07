/**
 * Shared note-type filter constants for the asset activity log.
 *
 * The activity tab lets users narrow the note stream to human comments or
 * system updates. The user-facing filter labels and the mapping from those
 * labels to the persisted {@link Note.type} enum are needed on BOTH sides of
 * the request:
 * - client: `NOTE_TYPE_FILTER_ITEMS` drives the `StatusFilter` options and the
 *   `?noteType=` query value (see `~/components/assets/notes`).
 * - server: `NOTE_TYPE_FILTER_MAP` maps that query value back to a `NoteType`
 *   when building the Prisma `where` (see `getPaginatedAndFilterableAssetNotes`
 *   in `~/modules/note/service.server`).
 *
 * Keeping them in one browser-safe module (string constants + a type-only
 * Prisma import, no server dependencies) makes the labels a single source of
 * truth: the map derives from the items, so a label rename can't silently
 * desync the two sides and stop the filter from narrowing.
 *
 * @see {@link file://./service.server.ts} getPaginatedAndFilterableAssetNotes
 * @see {@link file://./../../components/assets/notes/index.tsx} Notes
 */
import type { Note } from "@prisma/client";

/**
 * User-facing options for the note-type filter. The `StatusFilter` prepends an
 * "ALL" option automatically; these values are sent as `?noteType=` and mapped
 * back to the `NoteType` enum server-side via {@link NOTE_TYPE_FILTER_MAP}.
 * - Comments: human-authored notes (`COMMENT`)
 * - Updates: system activity entries (`UPDATE`)
 */
export const NOTE_TYPE_FILTER_ITEMS = {
  Comments: "Comments",
  Updates: "Updates",
} as const;

/**
 * Maps the user-facing `noteType` filter value (rendered by the shared
 * `StatusFilter`) to the {@link Note.type} stored on a note. Derived from
 * {@link NOTE_TYPE_FILTER_ITEMS} so the two stay in sync. Any other value —
 * including the "ALL" sentinel or an absent param — means "no type filter".
 *
 * Typed as a `Partial` record so indexing with an arbitrary/unknown key (e.g.
 * `""`, `"ALL"`) yields `Note["type"] | undefined`, matching runtime and
 * keeping the server-side `if (typeFilter)` narrowing type-safe.
 */
export const NOTE_TYPE_FILTER_MAP: Partial<Record<string, Note["type"]>> = {
  [NOTE_TYPE_FILTER_ITEMS.Comments]: "COMMENT",
  [NOTE_TYPE_FILTER_ITEMS.Updates]: "UPDATE",
};
