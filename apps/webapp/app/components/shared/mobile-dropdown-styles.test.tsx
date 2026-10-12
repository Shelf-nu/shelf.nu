import { renderToStaticMarkup } from "react-dom/server";
import resolveConfig from "tailwindcss/resolveConfig";
import { describe, expect, it } from "vitest";
import {
  MobileDropdownStyles,
  SHEET_MAX_WIDTH,
} from "./mobile-dropdown-styles";
import tailwindConfig from "../../../tailwind.config";

/**
 * The action menus style their content as a bottom sheet below Tailwind's `md`
 * breakpoint (`fixed bottom-0 ... md:static`). The positioning override must
 * cover exactly those widths: a narrower rule leaves a sheet still positioned
 * by Radix relative to its trigger, which opens it off the top of the screen
 * on tablets held upright.
 */
describe("MobileDropdownStyles", () => {
  it("covers every width the menus render as a bottom sheet", () => {
    const { screens } = resolveConfig(tailwindConfig).theme;
    const md = Number.parseInt(String(screens.md), 10);

    expect(SHEET_MAX_WIDTH).toBe(md - 1);
  });

  it("injects the rule for that width while the menu is open", () => {
    const html = renderToStaticMarkup(<MobileDropdownStyles open />);

    expect(html).toContain(`@media (max-width: ${SHEET_MAX_WIDTH}px)`);
    expect(html).toContain("transform: none !important");
  });

  it("injects nothing while the menu is closed", () => {
    expect(renderToStaticMarkup(<MobileDropdownStyles open={false} />)).toBe(
      ""
    );
  });
});
