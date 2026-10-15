import { beforeEach, describe, expect, it, vi } from "vitest";

import { SERVER_URL } from "~/utils/env";
import {
  assetImportFinishedEmailHtml,
  assetImportFinishedEmailText,
  sendAssetImportFinishedEmail,
} from "./asset-import-finished";
import type { AssetImportFinishedEmailProps } from "./asset-import-finished";

// why: no SMTP or queue in tests
vi.mock("./mail.server", () => ({ sendEmail: vi.fn() }));

// why: no database in unit tests
vi.mock("~/database/db.server", () => ({
  db: { assetImport: { findFirst: vi.fn() } },
}));

// why: assert the swallowed error is logged without writing real logs
vi.mock("~/utils/logger", () => ({ Logger: { error: vi.fn() } }));

const { sendEmail } = await import("./mail.server");
const { db } = await import("~/database/db.server");
const { Logger } = await import("~/utils/logger");

const base: AssetImportFinishedEmailProps = {
  startedBy: "Sam Lee",
  workspaceName: "Acme Workspace",
  customEmailFooter: null,
  fileName: "inventory.csv",
  outcome: "completed",
  totalRows: 120,
  processedRows: 120,
  warningCount: 0,
  errorMessage: null,
  importUrl: `${SERVER_URL}/assets/import/imp_1`,
};

const FOOTER_REASON =
  'This email was sent to you because you started this import in the workspace "Acme Workspace".';

describe("assetImportFinishedEmailText", () => {
  it("reports the completed import with heading, counts, workspace and assets link", () => {
    const text = assetImportFinishedEmailText(base);
    expect(text).toContain("Your asset import is complete");
    expect(text).toContain("inventory.csv | 120 assets");
    expect(text).toContain("Workspace: Acme Workspace");
    expect(text).toContain("Imported: 120 of 120 assets");
    expect(text).toContain("Started by: Sam Lee");
    expect(text).toContain(`View assets: ${SERVER_URL}/assets`);
    expect(text).toContain(FOOTER_REASON);
    expect(text).toContain("The Shelf Team");
    expect(text).not.toContain("Rows with warnings");
    expect(text).not.toContain("View import:");
    expect(text).not.toMatch(/[—–]/);
  });

  it("formats large counts with thousands separators", () => {
    const text = assetImportFinishedEmailText({
      ...base,
      outcome: "failed",
      totalRows: 10000,
      processedRows: 965,
      warningCount: 1234,
      errorMessage: "Stopped",
    });

    expect(text).toContain("| 10,000 assets");
    expect(text).toContain("965 of 10,000 assets");
    expect(text).toContain("1,234 (");
  });

  it("falls back to CSV import when there is no file name", () => {
    const text = assetImportFinishedEmailText({ ...base, fileName: null });
    expect(text).toContain("CSV import | 120 assets");
  });

  it("adds the warning count and import link when rows had warnings", () => {
    const text = assetImportFinishedEmailText({ ...base, warningCount: 3 });
    expect(text).toContain("Rows with warnings: 3");
    expect(text).toContain(`View import: ${SERVER_URL}/assets/import/imp_1`);
    expect(text).not.toMatch(/[—–]/);
  });

  it("reports the failed import with progress, reason and resume link", () => {
    const text = assetImportFinishedEmailText({
      ...base,
      outcome: "failed",
      processedRows: 40,
      errorMessage: "The database was unreachable.",
    });
    expect(text).toContain("Your asset import stopped");
    expect(text).toContain("inventory.csv | 120 assets");
    expect(text).toContain("Imported: 40 of 120 assets");
    expect(text).toContain("Reason: The database was unreachable.");
    expect(text).toContain("Nothing was imported twice.");
    expect(text).toContain(`Open import: ${SERVER_URL}/assets/import/imp_1`);
    expect(text).toContain(FOOTER_REASON);
    expect(text).not.toMatch(/[—–]/);
  });

  it("includes the workspace custom footer when set", () => {
    const text = assetImportFinishedEmailText({
      ...base,
      customEmailFooter: "Questions? Ask IT.",
    });
    expect(text).toContain("Questions? Ask IT.");
  });
});

describe("assetImportFinishedEmailHtml", () => {
  it("renders the h1 heading, subheading and the custom footer", async () => {
    const html = await assetImportFinishedEmailHtml({
      ...base,
      customEmailFooter: "Questions? Ask IT.",
    });
    expect(html).toMatch(/<h1[^>]*>Your asset import is complete<\/h1>/);
    expect(html).toContain("inventory.csv");
    expect(html).toContain("Questions? Ask IT.");
    expect(html).toContain("View assets");
    expect(html).not.toContain("View import");
  });

  it("omits the custom footer when the workspace has none", async () => {
    const html = await assetImportFinishedEmailHtml(base);
    expect(html).not.toContain("Questions? Ask IT.");
  });
});

describe("sendAssetImportFinishedEmail", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("does not throw when sending fails, and logs the error", async () => {
    vi.mocked(db.assetImport.findFirst).mockResolvedValue({
      fileName: "a.csv",
      totalRows: 2,
      processedRows: 2,
      warningCount: 0,
      errorMessage: null,
      organization: { name: "Acme Workspace", customEmailFooter: null },
      createdBy: {
        email: "sam@test",
        firstName: "Sam",
        lastName: "Lee",
        displayName: null,
      },
    } as never);
    vi.mocked(sendEmail).mockImplementation(() => {
      throw new Error("smtp down");
    });

    await expect(
      sendAssetImportFinishedEmail({
        importId: "imp_1",
        organizationId: "org_1",
        outcome: "completed",
      })
    ).resolves.toBeUndefined();
    expect(Logger.error).toHaveBeenCalledTimes(1);
  });

  it("does not throw when the import is missing", async () => {
    vi.mocked(db.assetImport.findFirst).mockResolvedValue(null);

    await expect(
      sendAssetImportFinishedEmail({
        importId: "imp_1",
        organizationId: "org_1",
        outcome: "failed",
      })
    ).resolves.toBeUndefined();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(Logger.error).toHaveBeenCalledTimes(1);
  });
});
