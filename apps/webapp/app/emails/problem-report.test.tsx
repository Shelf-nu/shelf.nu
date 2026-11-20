/**
 * Rendering tests for the problem report email.
 *
 * Asserts what one recipient's copy carries in both the HTML and the plain
 * text body: the greeting, who reported which asset in which workspace, the
 * report text as typed, the link to the asset and the footer.
 *
 * @see {@link file://./problem-report.tsx}
 */
import { describe, expect, it, vi } from "vitest";

// why: env vars are read at import time; the logo and shelf.config.ts import
// from this module
vi.mock("~/utils/env", () => ({
  SERVER_URL: "https://app.shelf.nu",
  SUPPORT_EMAIL: "support@shelf.nu",
  SEND_ONBOARDING_EMAIL: false,
  ENABLE_PREMIUM_FEATURES: false,
  FREE_TRIAL_DAYS: "7",
  DISABLE_SIGNUP: false,
  DISABLE_SSO: false,
  ENABLE_SCIM: false,
  SHOW_HOW_DID_YOU_FIND_US: false,
  COLLECT_BUSINESS_INTEL: false,
  GEOCODING_USER_AGENT: "",
}));

import type { ProblemReportEmailProps } from "./problem-report";
import {
  problemReportEmailHtml,
  problemReportEmailText,
  problemReportSubject,
} from "./problem-report";

const props: ProblemReportEmailProps = {
  greetingName: "Sam",
  recipientEmail: "sam@example.com",
  workspaceName: "ZZ Workspace",
  assetId: "asset-1",
  assetTitle: "ZZ Camera",
  reporterName: "Bea Base",
  content: 'The lens is cracked <b>"badly"</b>\nand the strap is torn',
  customEmailFooter: null,
};

const ASSET_URL = "https://app.shelf.nu/assets/asset-1";

describe("problem report email", () => {
  it("names the asset in the subject", () => {
    expect(problemReportSubject("ZZ Camera")).toBe(
      "Problem reported: ZZ Camera"
    );
  });

  it("carries the report, the reporter, the asset and its link in the text body", () => {
    const text = problemReportEmailText(props);

    expect(text).toContain("Hey Sam,");
    expect(text).toContain(
      "Bea Base reported a problem with ZZ Camera in ZZ Workspace."
    );
    expect(text).toContain(props.content);
    expect(text).toContain(`View asset: ${ASSET_URL}`);
    expect(text).toContain("This email was sent to sam@example.com");
  });

  it("carries the same in the HTML body, with the report text escaped", async () => {
    // React separates adjacent text with `<!-- -->`; drop it to read the text.
    const html = (await problemReportEmailHtml(props)).replace(/<!-- -->/g, "");

    expect(html).toContain("Hey Sam,");
    expect(html).toContain(
      "<strong>Bea Base</strong> reported a problem with <strong>ZZ Camera</strong> in <strong>ZZ Workspace</strong>"
    );
    expect(html).toContain(`href="${ASSET_URL}"`);
    expect(html).toContain(
      "The lens is cracked &lt;b&gt;&quot;badly&quot;&lt;/b&gt;"
    );
    expect(html).not.toContain("<b>");
    expect(html).toContain("sam@example.com");
  });
});
