/**
 * ESLint rule banning test files from `app/routes/`.
 *
 * Vite's dev-server warmup (`server.warmup.clientFiles` in `vite.config.ts`)
 * pulls every file under `app/routes/` into the CLIENT module graph. A test
 * file co-located there is not a route — `ignoredRouteFiles` in
 * `app/routes.ts` excludes it from the route tree — but warmup does not care,
 * so the moment it imports a `*.server` module React Router rejects it:
 *
 *   Pre-transform error: Server-only module referenced by client
 *     '~/modules/api/mobile-auth.server' imported by
 *     'app/routes/api+/mobile+/qr.claim.test.ts'
 *
 * Route tests almost always import a `*.server` module (that IS the thing
 * under test), so in practice every co-located route test breaks
 * `pnpm webapp:dev`. Typecheck, lint and the unit suite all still PASS, so
 * `pnpm webapp:validate` and CI never catch it — the only signal is a broken
 * dev server, which is why this has regressed more than once.
 *
 * Route tests belong in `apps/webapp/test/routes-tests/`, importing the route
 * through the `~/routes/...` alias instead of a relative path.
 *
 * ❌ Bad:  app/routes/api+/mobile+/qr.claim.test.ts
 *          import { action } from "./qr.claim";
 *
 * ✅ Good: test/routes-tests/api+/mobile+/qr.claim.test.ts
 *          import { action } from "~/routes/api+/mobile+/qr.claim";
 *
 * @see {@link file://../vite.config.ts} the warmup globs that cause this
 * @see {@link file://../app/routes.ts} ignoredRouteFiles (route tree exclusion)
 * @see {@link file://../../../.claude/rules/no-test-files-in-app-routes.md}
 */

/** Matches `*.test.ts` / `*.spec.tsx` / `*.test.server.ts` and friends. */
const TEST_FILE_PATTERN = /\.(test|spec)(\.[^./]+)*\.[cm]?[jt]sx?$/;

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow test files inside app/routes/ — Vite's dev-server warmup treats them as client modules, so any *.server import breaks the dev server",
      recommended: true,
    },
    schema: [],
    messages: {
      testFileInRoutes:
        'Test files are not allowed in "app/routes/". Vite warms every file under app/routes/ as a CLIENT module, so importing a "*.server" module here breaks `pnpm webapp:dev` (validate/CI will not catch it). Move this to "apps/webapp/test/routes-tests/{{suggested}}" and import the route via "~/routes/..." instead of a relative path.',
    },
  },

  create(context) {
    const filename = context.getFilename();

    // RuleTester passes "<input>" when a case supplies no filename.
    if (!filename || filename === "<input>" || filename === "<text>") {
      return {};
    }

    // Normalize Windows separators so the path checks below are portable.
    const normalized = filename.replace(/\\/g, "/");

    // The `(?:^|\/)` alternation matters: ESLint reports absolute paths in
    // most contexts but repo-relative ones when lefthook passes staged files,
    // and the rule must fire identically for both. The capture group is
    // everything below app/routes/, e.g. "api+/mobile+/qr.claim.test.ts".
    const routesMatch = normalized.match(/(?:^|\/)app\/routes\/(.+)$/);
    if (!routesMatch) {
      return {};
    }

    const pathBelowRoutes = routesMatch[1];
    const basename = pathBelowRoutes.slice(
      pathBelowRoutes.lastIndexOf("/") + 1
    );
    if (!TEST_FILE_PATTERN.test(basename)) {
      return {};
    }

    // Mirror the file's position under app/routes/ so the message names the
    // exact destination path.
    const suggested = pathBelowRoutes
      // `.test.server.ts` has no reason to exist outside app/routes/ — the
      // `.server` infix only ever existed to dodge the warmup glob.
      .replace(/\.test\.server\.([cm]?[jt]sx?)$/, ".test.$1");

    return {
      Program(node) {
        context.report({
          node,
          messageId: "testFileInRoutes",
          data: { suggested },
        });
      },
    };
  },
};
