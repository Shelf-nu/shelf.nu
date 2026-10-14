import { beforeEach, describe, expect, it, vi } from "vitest";

import { SERVER_URL } from "~/utils/env";
import {
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
  firstName: "Sam",
  workspaceName: "Acme Workspace",
  outcome: "completed",
  totalRows: 120,
  processedRows: 120,
  warningCount: 0,
  errorMessage: null,
  importUrl: `${SERVER_URL}/assets/import/imp_1`,
};

describe("assetImportFinishedEmailText", () => {
  it("reports the completed import with counts, workspace and assets link", () => {
    const text = assetImportFinishedEmailText(base);
    expect(text).toContain("Hey Sam,");
    expect(text).toContain("120 assets were imported into Acme Workspace.");
    expect(text).toContain(`${SERVER_URL}/assets`);
    expect(text).not.toContain("with a warning");
    expect(text).not.toMatch(/[—–]/);
  });

  it("adds the warning notice and import link when rows had warnings", () => {
    const text = assetImportFinishedEmailText({ ...base, warningCount: 3 });
    expect(text).toContain("3 rows were imported with a warning");
    expect(text).toContain(`${SERVER_URL}/assets/import/imp_1`);
    expect(text).not.toMatch(/[—–]/);
  });

  it("reports the failed import with progress, error and resume link", () => {
    const text = assetImportFinishedEmailText({
      ...base,
      outcome: "failed",
      processedRows: 40,
      errorMessage: "The database was unreachable.",
    });
    expect(text).toContain(
      "We imported 40 of 120 assets into Acme Workspace before the import stopped."
    );
    expect(text).toContain("The database was unreachable.");
    expect(text).toContain("Nothing was imported twice.");
    expect(text).toContain(`${SERVER_URL}/assets/import/imp_1`);
    expect(text).not.toMatch(/[—–]/);
  });
});

describe("sendAssetImportFinishedEmail", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("does not throw when sending fails, and logs the error", async () => {
    vi.mocked(db.assetImport.findFirst).mockResolvedValue({
      totalRows: 2,
      processedRows: 2,
      warningCount: 0,
      errorMessage: null,
      organization: { name: "Acme Workspace" },
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
