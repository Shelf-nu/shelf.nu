import { describe, expect, it } from "vitest";
import { ASSET_CSV_HEADERS } from "~/modules/asset/utils.server";
import { IMPORT_FIELD_NAMES } from "./fields";

describe("IMPORT_FIELDS", () => {
  it("names exactly the headers the create importer reads", () => {
    // `id` is accepted by the importer but never read on create.
    const importerHeaders = ASSET_CSV_HEADERS.filter((name) => name !== "id");
    expect([...IMPORT_FIELD_NAMES].sort()).toEqual([...importerHeaders].sort());
  });
});
