import { useLoaderData } from "@remix-run/react";
import type { loader } from "~/routes/_layout+/kits.$kitId";
import { BookActionsDropDown as ConditionalBookActionsDropdown } from "~/utils/booking-drop-down-actions";
import type { Link } from "~/utils/booking-drop-down-actions";

export default function BookingActionsDropDown() {
  const { kit } = useLoaderData<typeof loader>();
  const kitIsCheckedOut = kit.status === "CHECKED_OUT";

  const someAssetIsNotAvailable = kit.assets.some(
    (asset) => asset.status !== "AVAILABLE"
  );
  const noAssets = kit.assets.length === 0;
  const disabled = kitIsCheckedOut || someAssetIsNotAvailable || noAssets;

  const reason = disabled
    ? {
        reason: noAssets
          ? "Kit has no assets. Please add some assets to be able to book this kit."
          : someAssetIsNotAvailable
          ? "Some of the assets inside the kit are not available for bookings"
          : "Kit is not available for bookings",
      }
    : false;
  const links = [
    {
      indexType: "kit",
      id: kit.id,
      disabled,
      label: "Create new booking",
      icon: "bookings",
      disabledReason: reason,
      to: `/bookings/new?${kit.assets.map((a) => `assetId=${a.id}`).join("&")}`,
    },
    {
      indexType: "kit",
      id: kit.id,
      label: "Add to existing booking",
      icon: "booking-exist",
      disabled,
      disabledReason: reason,
      to: `/bookings/update-existing?indexType=kits&id=${kit.id}`,
    },
  ] as Link[];

  return (
    <div className="actions-dropdown flex">
      <ConditionalBookActionsDropdown links={links} indexType={"Kit"} />
    </div>
  );
}
