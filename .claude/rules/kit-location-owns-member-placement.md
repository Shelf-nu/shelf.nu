# A Kit's Location Owns Its Members' Placement

`Kit.locationId` is the source of truth for where its member assets are. Any
flow that changes kit membership or a kit's location MUST keep `AssetLocation`
in step — go through `cascadeKitLocationToAssets` (kit → members) and
`preserveKitDrivenPlacements` (before ANY `assetKit.delete*`), both in
`~/modules/kit/service.server`. Don't hand-roll the pivot writes: two triggers
and two partial uniques make it non-obvious, and the last hand-rolled version
silently no-op'd for ~every real kit.

Placement is **type-aware** — reaching for one shape for both is the bug:

| Member type        | Row written                                                  | Why                                                                                             |
| ------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `INDIVIDUAL`       | **plain** (`assetKitId: null`), qty 1                        | `enforce_individual_asset_single_location` caps it at ONE row; a plain row also survives detach |
| `QUANTITY_TRACKED` | **kit-driven** (`assetKitId` set), qty = `AssetKit.quantity` | only the kit's slice moves; the discriminator lets the next move find it                        |

After writing QT slices, reclaim any overflow past `Asset.quantity` from manual
rows — the DEFERRED `enforce_asset_location_sum_within_total` aborts the whole
tx at COMMIT otherwise. Detach converts kit-driven rows to manual (merging on
an `(assetId, locationId)` collision) — unpacking a kit must not unplace its
contents.

❌ Bad — the shipped bug: skip members that already have a placement.

```ts
// INDIVIDUAL members keep a manual row forever (membership never converts it),
// so this filter made the cascade a permanent no-op — 5,110 rows vs 1 locally.
const manualAssetIds = /* assetKitId: null, asset: { type: "INDIVIDUAL" } */;
const dataToCreate = assetKits.filter((ak) => !manualAssetIds.has(ak.assetId));
```

✅ Good — one shared cascade, and the audit trail follows what persisted.

```ts
const cascadedAssetIds = await cascadeKitLocationToAssets(
  { kitIds: [id], newLocationId, organizationId },
  tx
);
// emit ASSET_LOCATION_CHANGED + notes ONLY for cascadedAssetIds
```

Emit events/notes strictly for rows that actually changed — including the
clear-location path, where INDIVIDUAL members keep their placement and so must
NOT be reported as unplaced. When you touch one of these flows, grep the
siblings (`updateKitLocation`, `bulkUpdateKitLocation`, `updateKitAssets`,
`bulkRemoveAssetsFromKits`, `moveAssetKitUnits`, `performKitDeletion`) — this
bug class travels in packs. See [[kit-members-via-kit-slices]] and
[[quantity-semantics-per-surface]].
