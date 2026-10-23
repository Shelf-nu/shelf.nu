/**
 * Date/time formatting — thin re-export of the shared `@shelf/datetime` package.
 *
 * The formatter core lives in `packages/datetime/src/index.ts` so the webapp and
 * the companion (Expo/React Native) app share ONE implementation and their date
 * rendering never drifts. This file preserves the `~/utils/date-format` import
 * path used across ~54 webapp sites (loaders, `DateS`, detection/persistence) —
 * every symbol (`formatDate`, `resolveFormatPrefs`, `HARDCODED_DEFAULT_PREFS`,
 * the `RawFormatPrefs` / `ResolvedFormatPrefs` / `DetectedFormatPrefs` /
 * `DateFormatOptions` types, `isValidTimeZone`, the `detect*` helpers,
 * `getCachedFormatter`, …) is re-exported unchanged.
 *
 * One rename crossed the move: the `hints` param type `ClientHint` became the
 * dependency-free `FormatHints` (`{ locale, timeZone }`). `ClientHint` is
 * structurally identical, so every existing call site passes through unchanged.
 *
 * @see {@link file://../../../../packages/datetime/src/index.ts} the implementation
 * @see {@link file://./client-hints.tsx} ClientHint / getClientHint (hint builders)
 * @see {@link file://./date-format.server.ts} resolveUserFormatPrefsById
 */
export * from "@shelf/datetime";
