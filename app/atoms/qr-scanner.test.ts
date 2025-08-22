import { createStore } from "jotai/vanilla";
import {
  auditSessionAtom,
  auditExpectedAssetsAtom,
  auditResultsAtom,
  scannedItemsAtom,
  startAuditSessionAtom,
  setAuditExpectedAssetsAtom,
  endAuditSessionAtom,
} from "./qr-scanner";

// @vitest-environment happy-dom
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

describe("Audit Scanner Atoms", () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
  });

  describe("auditSessionAtom", () => {
    it("should start with null value", () => {
      const session = store.get(auditSessionAtom);
      expect(session).toBeNull();
    });

    it("should update when starting an audit session", () => {
      const sessionInfo = {
        id: "test-audit-id",
        type: "LOCATION" as const,
        targetId: "test-location-id",
        expectedAssetCount: 5,
        foundAssetCount: 0,
        missingAssetCount: 0,
        unexpectedAssetCount: 0,
      };

      store.set(startAuditSessionAtom, sessionInfo);
      const session = store.get(auditSessionAtom);

      expect(session).toEqual(sessionInfo);
    });

    it("should clear when ending an audit session", () => {
      const sessionInfo = {
        id: "test-audit-id",
        type: "LOCATION" as const,
        targetId: "test-location-id",
        expectedAssetCount: 5,
        foundAssetCount: 0,
        missingAssetCount: 0,
        unexpectedAssetCount: 0,
      };

      store.set(startAuditSessionAtom, sessionInfo);
      store.set(endAuditSessionAtom);

      const session = store.get(auditSessionAtom);
      expect(session).toBeNull();
    });
  });

  describe("auditExpectedAssetsAtom", () => {
    it("should start with empty array", () => {
      const assets = store.get(auditExpectedAssetsAtom);
      expect(assets).toEqual([]);
    });

    it("should update with expected assets", () => {
      const expectedAssets = [
        {
          id: "asset-1",
          name: "Test Asset 1",
          type: "asset" as const,
          auditStatus: "missing" as const,
        },
        {
          id: "asset-2",
          name: "Test Asset 2",
          type: "asset" as const,
          auditStatus: "missing" as const,
        },
      ];

      store.set(setAuditExpectedAssetsAtom, expectedAssets);
      const assets = store.get(auditExpectedAssetsAtom);

      expect(assets).toEqual(expectedAssets);
    });
  });

  describe("auditResultsAtom", () => {
    it("should return all assets as missing when no session is active", () => {
      const expectedAssets = [
        {
          id: "asset-1",
          name: "Test Asset 1",
          type: "asset" as const,
          auditStatus: "missing" as const,
        },
      ];

      store.set(setAuditExpectedAssetsAtom, expectedAssets);
      const results = store.get(auditResultsAtom);

      expect(results).toEqual({
        found: [],
        missing: expectedAssets,
        unexpected: [],
      });
    });

    it("should categorize scanned assets correctly", () => {
      // Start audit session
      const sessionInfo = {
        id: "test-audit-id",
        type: "LOCATION" as const,
        targetId: "test-location-id",
        expectedAssetCount: 2,
        foundAssetCount: 0,
        missingAssetCount: 0,
        unexpectedAssetCount: 0,
      };
      store.set(startAuditSessionAtom, sessionInfo);

      // Set expected assets
      const expectedAssets = [
        {
          id: "asset-1",
          name: "Expected Asset 1",
          type: "asset" as const,
          auditStatus: "missing" as const,
        },
        {
          id: "asset-2",
          name: "Expected Asset 2",
          type: "asset" as const,
          auditStatus: "missing" as const,
        },
      ];
      store.set(setAuditExpectedAssetsAtom, expectedAssets);

      // Add scanned items
      const scannedItems = {
        "qr-1": {
          type: "asset" as const,
          data: {
            id: "asset-1",
            title: "Expected Asset 1",
          },
        },
        "qr-2": {
          type: "asset" as const,
          data: {
            id: "asset-3",
            title: "Unexpected Asset",
          },
        },
      };
      store.set(scannedItemsAtom, scannedItems);

      const results = store.get(auditResultsAtom);

      expect(results.found).toHaveLength(1);
      expect(results.found[0].id).toBe("asset-1");
      expect(results.found[0].auditStatus).toBe("found");

      expect(results.missing).toHaveLength(1);
      expect(results.missing[0].id).toBe("asset-2");

      expect(results.unexpected).toHaveLength(1);
      expect(results.unexpected[0].id).toBe("asset-3");
      expect(results.unexpected[0].auditStatus).toBe("unexpected");
    });
  });
});
