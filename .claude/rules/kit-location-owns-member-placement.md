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

**The two axes are additive — never reclaim units from manual rows to "make
room" for a kit slice.** Since
`20260602100000_assetlocation_sum_exclude_kit_driven`,
`enforce_asset_location_sum_within_total` sums only `assetKitId IS NULL` rows;
the kit axis is bounded separately by `enforce_asset_kit_sum_within_total`. So
100 manually-placed units plus a 50-unit kit slice is VALID, and trimming the
manual row destroys real data.

The inverse bites too, which is why **detach preserves the location for
INDIVIDUAL members only**: converting a kit-driven row to manual moves those
units _into_ the capped axis, so a fully-placed QT asset would breach the cap
and abort the entire detach (removal, bulk removal, kit deletion, full-slice
move). QT slices are left to `onDelete: Cascade` and simply become unplaced.
`Asset.quantity` is NULL for INDIVIDUAL, so the cap never applies to them.

Read the trigger you are relying on from the **latest** migration that touches
it, not the one that created it. The original pivot migration summed both axes;
a later one inverted that, and code written against the original silently
deleted valid placements.

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
