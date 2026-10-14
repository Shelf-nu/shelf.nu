/**
 * Tests for {@link MobileDropdownStyles}: the rule that lets an action menu's
 * bottom sheet sit at the bottom of the viewport, and the width check its
 * menus share.
 *
 * The menus style their content as a bottom sheet below Tailwind's `md`
 * breakpoint (`fixed bottom-0 ... md:static`). The positioning override, the
 * open-only trigger, the QR-scan auto-open and the close handling must all
 * switch at exactly that width, and every menu that renders a sheet must
 * render the override: without it a sheet stays positioned by Radix relative
 * to its trigger, which opens it off the top of the screen.
 *
 * @see {@link file://./mobile-dropdown-styles.tsx}
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Window as HappyDOMWindow } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";
import resolveConfig from "tailwindcss/resolveConfig";
import { describe, expect, it } from "vitest";
import {
  MobileDropdownStyles,
  SHEET_MEDIA_QUERY,
  isSheetViewport,
} from "./mobile-dropdown-styles";
import tailwindConfig from "../../../tailwind.config";

/** `app/`: components and routes both render menus. */
const APP = resolve(__dirname, "../..");

/** Every non-test `.tsx` file under `dir`, recursively. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")
      ? [path]
      : [];
  });
}

/**
 * One string literal, in any quote style (a `className`, a `tw(...)` argument
 * or a template literal), holding both `fixed` and `bottom-0`.
 */
const SHEET_CLASSES =
  /["'`][^"'`]*(\bfixed\b[^"'`]*\bbottom-0\b|\bbottom-0\b[^"'`]*\bfixed\b)/;

/**
 * Files whose popper content holds a bottom sheet: a Radix menu or popover
 * content plus a fixed, bottom-anchored element.
 */
const SHEET_MENUS = sourceFiles(APP)
  .map((file) => ({ file, source: readFileSync(file, "utf8") }))
  .filter(
    ({ source }) =>
      /<(DropdownMenuContent|PopoverContent)\b/.test(source) &&
      SHEET_CLASSES.test(source)
  );

/** The sheet menus whose source matches `pattern`, as paths under `app/`. */
function sheetMenusWhere(pattern: (source: string) => boolean): string[] {
  return SHEET_MENUS.filter(({ source }) => pattern(source)).map(({ file }) =>
    relative(APP, file)
  );
}

/** Resizes the test window; `matchMedia` answers for the new width. */
function setViewportWidth(width: number) {
  (window as unknown as HappyDOMWindow).happyDOM.setViewport({
    width,
    height: 900,
  });
}

describe("MobileDropdownStyles", () => {
  it("covers every width the menus render as a bottom sheet", () => {
    const { screens } = resolveConfig(tailwindConfig).theme;

    // The exact complement of `md`, so no viewport width falls between them.
    expect(SHEET_MEDIA_QUERY).toBe(`not all and (min-width: ${screens.md})`);
  });

  it("injects the rule for that width while the menu is open", () => {
    const html = renderToStaticMarkup(<MobileDropdownStyles open />);

    expect(html).toContain(`@media ${SHEET_MEDIA_QUERY}`);
    // Only the wrapper holding the sheet, so a tooltip shown over the sheet
    // keeps its own position.
    expect(html).toContain(
      "[data-radix-popper-content-wrapper]:has([data-mobile-sheet]) {\n    transform: none !important;"
    );
  });

  it("fades sheets in from a stylesheet that outlives the open menu", () => {
    const globalCss = readFileSync(resolve(APP, "styles/global.css"), "utf8");

    // Same widths as the sheet, and not in the injected rule: an animation
    // name that changes on close keeps the closed sheet on screen.
    expect(globalCss).toContain(
      `@media ${SHEET_MEDIA_QUERY} {\n  [data-mobile-sheet] {\n    animation-name: mobileSheetFadeIn !important;`
    );
    expect(renderToStaticMarkup(<MobileDropdownStyles open />)).not.toContain(
      "animation"
    );
  });

  it("injects nothing while the menu is closed", () => {
    expect(renderToStaticMarkup(<MobileDropdownStyles open={false} />)).toBe(
      ""
    );
  });
});

describe("isSheetViewport", () => {
  it.each([375, 640, 712, 767])("is true at %ipx", (width) => {
    setViewportWidth(width);

    expect(isSheetViewport()).toBe(true);
  });

  it.each([768, 1024])("is false at %ipx", (width) => {
    setViewportWidth(width);

    expect(isSheetViewport()).toBe(false);
  });
});

describe("menus that render a bottom sheet", () => {
  it("are all found", () => {
    // Guards the scan itself: a pattern that stopped matching would pass empty.
    expect(SHEET_MENUS.length).toBeGreaterThan(20);
  });

  it("render the positioning rule and mark their sheet", () => {
    expect(
      sheetMenusWhere((source) => !/<MobileDropdownStyles\b/.test(source))
    ).toEqual([]);
    expect(
      sheetMenusWhere((source) => !source.includes("data-mobile-sheet"))
    ).toEqual([]);
  });

  it("switch their behaviour at the same width as the sheet", () => {
    // Both triggers switch at `md`, like the sheet styling.
    expect(
      sheetMenusWhere((source) => /\bsm:(hidden|flex)\b/.test(source))
    ).toEqual([]);
    // Width checks read `isSheetViewport`, never a hand-written pixel value.
    expect(sheetMenusWhere((source) => source.includes("innerWidth"))).toEqual(
      []
    );
  });

  it("cap every popover sheet against the viewport", () => {
    // The rule caps `DropdownMenuContent` sheets itself; a `PopoverContent`
    // sheet has no menu attribute to target, so it must carry its own cap or
    // a long menu runs off the top of a short screen.
    expect(
      sheetMenusWhere(
        (source) =>
          /<PopoverContent\b/.test(source) && !source.includes("max-h-[85dvh]")
      )
    ).toEqual([]);
  });
});
