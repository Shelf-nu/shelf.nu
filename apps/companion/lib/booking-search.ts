/**
 * Search over the assets and kits on the booking detail screen.
 *
 * The booking endpoint returns the whole booking in one response, so the phone
 * searches the rows it already holds rather than asking the server again. An
 * asset is found by the fields the payload carries: its title, category and
 * location, the name of its kit or of any kit its units are booked through,
 * and its kit's location and category.
 *
 * This follows the web booking search, `filterBookingAssets` in
 * `apps/webapp/app/modules/booking/helpers.ts`. It is written against the
 * mobile payload rather than copied, and it differs in two ways: it cannot see
 * the fields the phone does not receive (SAM ID, tags, QR and barcode values),
 * and it matches the term as one string, where the web splits on commas and
 * reads each part as an alternative.
 *
 * A match inside a kit brings the whole kit back, as it does on the web. The
 * screen treats a kit as one thing: its header counts, badges and selects the
 * members it holds, and a removal may only name a kit whose members are all on
 * the list. A search therefore returns a kit whole or not at all.
 *
 * Pure and free of React Native so the rules can be tested under Node.
 *
 * @see ../app/(tabs)/bookings/[id].tsx — the only consumer
 * @see ./booking-kit-rows.ts — groups the result into kit and asset rows
 * @see ../../webapp/app/modules/booking/helpers.ts — the web search
 */
import type { BookingAsset, BookingKit } from "./api/types";

/**
 * The strings an asset can be found by: what its row shows, plus the location
 * and category its kit header shows above it.
 *
 * @param asset - the asset to describe
 * @param kitsById - the booking's kits, keyed by `Kit.id`
 * @returns every searchable value, some of them absent
 */
function searchableFields(
  asset: BookingAsset,
  kitsById: ReadonlyMap<string, BookingKit>
): (string | null | undefined)[] {
  const kit = asset.kit ? kitsById.get(asset.kit.id) : undefined;
  return [
    asset.title,
    asset.category?.name,
    asset.location?.name,
    asset.kit?.name,
    kit?.location?.name,
    kit?.category?.name,
    // A quantity-tracked asset booked through several kits names each of them
    // on its row, so a search for any of those kits finds it.
    ...(asset.slices?.map((slice) => slice.kit?.name) ?? []),
  ];
}

/**
 * The assets a search term finds on a booking.
 *
 * Matching is a case-insensitive substring test on the trimmed term. Every
 * other member of a matching asset's kit comes back with it, keyed on `kitId`
 * because that is what the list groups by.
 *
 * @param assets - the booking's assets, in the order the server sent them
 * @param kits - the kits sent alongside them; absent from an older server
 * @param term - what the user typed
 * @returns the found assets in their original order, or `assets` itself when
 *   the term is blank, so a memo keyed on the result does not rebuild
 */
export function filterBookingAssets(
  assets: BookingAsset[],
  kits: BookingKit[] | undefined,
  term: string
): BookingAsset[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return assets;

  const kitsById = new Map((kits ?? []).map((kit) => [kit.id, kit]));
  const foundIds = new Set<string>();
  const foundKitIds = new Set<string>();
  for (const asset of assets) {
    const found = searchableFields(asset, kitsById).some(
      (field) => field != null && field.toLowerCase().includes(needle)
    );
    if (!found) continue;
    foundIds.add(asset.id);
    if (asset.kitId) foundKitIds.add(asset.kitId);
  }

  return assets.filter(
    (asset) =>
      foundIds.has(asset.id) ||
      (asset.kitId != null && foundKitIds.has(asset.kitId))
  );
}
