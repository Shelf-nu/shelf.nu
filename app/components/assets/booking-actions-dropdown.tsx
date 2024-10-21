import { useLoaderData } from "@remix-run/react";
import type { loader } from "~/routes/_layout+/assets.$assetId";
import { BookActionsDropDown as ConditionalBookActionsDropdown } from "~/utils/booking-drop-down-actions";
import type { Link } from "~/utils/booking-drop-down-actions";

import { Button } from "../shared/button";

export default function BookingActionsDropDown() {
  const { asset } = useLoaderData<typeof loader>();
  const assetIsCheckedOut = asset.status === "CHECKED_OUT";
  const assetIsPartOfUnavailableKit = Boolean(
    asset.kit && asset.kit.status !== "AVAILABLE"
  );

  const reason = asset.kit
    ? {
        reason: (
          <>
            Cannot book this asset directly because it's part of a kit. Please
            book the{" "}
            <Button to={`/kits/${asset.kit.id}`} target="_blank" variant="link">
              kit
            </Button>{" "}
            instead.
          </>
        ),
      }
    : false;
  const disabled =
    assetIsCheckedOut || assetIsPartOfUnavailableKit || asset.kit;
  const links = [
    {
      indexType: "asset",
      id: asset.id,
      disabled,
      label: "Create new booking",
      icon: "bookings",
      disabledReason: reason,
      to: `/bookings/new?assetId=${asset.id}`,
    },
    {
      indexType: "asset",
      id: asset.id,
      label: "Add to existing booking",
      icon: "booking-exist",
      disabled,
      disabledReason: reason,
      to: `/bookings/update-existing?indexType=assets&id=${asset.id}`,
    },
  ] as Link[];

  return (
    <div className="actions-dropdown flex">
      <ConditionalBookActionsDropdown links={links} indexType={"Asset"} />
    </div>
  );
}
