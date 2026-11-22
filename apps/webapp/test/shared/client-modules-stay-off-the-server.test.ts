/**
 * `*.client` exports must never run on the server.
 *
 * React Router strips every export of a `*.client` module from the server
 * bundle, so on the server each one is `undefined`. Calling one there throws
 * `TypeError: x is not a function` and the request 500s. Vitest does not apply
 * that stubbing, so unit and route tests pass over the bug; only a real server
 * render finds it.
 *
 * Two places run on the server and are checked here:
 * - layout chrome (`app/components/layout`), which renders during SSR outside
 *   the `_layout` hydration gate that shields route content;
 * - route `loader` / `action` code, i.e. everything a route file declares
 *   before its default component.
 *
 * Server-side permission checks use `roleHasPermission` from
 * `~/utils/permissions/permission.data`, which is pure.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const APP = resolve(__dirname, "../../app");

/** Every non-test `.ts`/`.tsx` file under `dir`, recursively. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

/** Source with block and line comments removed, so prose never matches. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Value names a file imports from any `*.client` module. */
function clientImports(source: string): string[] {
  return [
    ...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*\.client["']/g),
  ].flatMap((m) =>
    m[1]
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name && !name.startsWith("type "))
      .map((name) => name.split(/\s+as\s+/).pop() as string)
  );
}

describe("*.client exports stay off the server", () => {
  it("layout chrome imports no *.client module", () => {
    const offenders = sourceFiles(join(APP, "components/layout"))
      .filter((file) => clientImports(readFileSync(file, "utf8")).length > 0)
      .map((file) => relative(APP, file));

    expect(offenders).toEqual([]);
  });

  it("no route calls a *.client export before its default component", () => {
    const offenders = sourceFiles(join(APP, "routes")).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const names = clientImports(source);
      if (names.length === 0) return [];

      // Loaders, actions and their helpers precede the default component.
      const serverPart = stripComments(
        source.split(/export default function/)[0]
      ).replace(/import[\s\S]*?from\s*["'][^"']+["'];?/g, "");

      return names
        .filter((name) => new RegExp(`\\b${name}\\s*\\(`).test(serverPart))
        .map((name) => `${relative(APP, file)}: ${name}`);
    });

    expect(offenders).toEqual([]);
  });
});
