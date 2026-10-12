/**
 * Tests for {@link MobileDropdownStyles}: the rule that lets an action menu's
 * bottom sheet sit at the bottom of the viewport.
 *
 * The menus style their content as a bottom sheet below Tailwind's `md`
 * breakpoint (`fixed bottom-0 ... md:static`). The positioning override must
 * cover exactly those widths, and every menu that renders a sheet must render
 * it: without the rule a sheet stays positioned by Radix relative to its
 * trigger, which opens it off the top of the screen.
 *
 * @see {@link file://./mobile-dropdown-styles.tsx}
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import resolveConfig from "tailwindcss/resolveConfig";
import { describe, expect, it } from "vitest";
import {
  MobileDropdownStyles,
  SHEET_MEDIA_QUERY,
} from "./mobile-dropdown-styles";
import tailwindConfig from "../../../tailwind.config";

const COMPONENTS = resolve(__dirname, "..");

/** Every non-test `.tsx` file under `dir`, recursively. */
function componentFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return componentFiles(path);
    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")
      ? [path]
      : [];
  });
}

/**
 * Components whose popper content holds a bottom sheet: a Radix menu or
 * popover content plus a `fixed bottom-0` element.
 */
function sheetMenus(): { file: string; source: string }[] {
  return componentFiles(COMPONENTS)
    .map((file) => ({ file, source: readFileSync(file, "utf8") }))
    .filter(
      ({ source }) =>
        /<(DropdownMenuContent|PopoverContent)\b/.test(source) &&
        /className="[^"]*\bfixed bottom-0\b/.test(source)
    );
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
    expect(html).toContain("transform: none !important");
  });

  it("injects nothing while the menu is closed", () => {
    expect(renderToStaticMarkup(<MobileDropdownStyles open={false} />)).toBe(
      ""
    );
  });

  it("is rendered by every menu that styles its content as a bottom sheet", () => {
    const menus = sheetMenus();
    const missing = menus
      .filter(({ source }) => !/<MobileDropdownStyles\b/.test(source))
      .map(({ file }) => relative(COMPONENTS, file));

    // Guards the scan itself: a pattern that stopped matching would pass empty.
    expect(menus.length).toBeGreaterThan(20);
    expect(missing).toEqual([]);
  });

  it("caps every popover sheet against the viewport", () => {
    // The rule caps `DropdownMenuContent` sheets itself; a `PopoverContent`
    // sheet has no menu attribute to target, so it must carry its own cap or
    // a long menu runs off the top of a short screen.
    const uncapped = sheetMenus()
      .filter(({ source }) => /<PopoverContent\b/.test(source))
      .filter(({ source }) => !source.includes("max-h-[85dvh]"))
      .map(({ file }) => relative(COMPONENTS, file));

    expect(uncapped).toEqual([]);
  });
});
