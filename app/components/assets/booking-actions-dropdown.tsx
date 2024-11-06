import { useLoaderData } from "@remix-run/react";
import type { loader } from "~/routes/_layout+/assets.$assetId";
import { Button } from "../shared/button";
import type { BookLink } from "../shared/generic-add-to-bookings-actions-dropdown";
import { GenericBookActionsDropdown } from "../shared/generic-add-to-bookings-actions-dropdown";

export default function BookingActionsDropdown() {
  const { asset } = useLoaderData<typeof loader>();
  const { availableToBook } = asset;

  const disabled = asset.kit
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

  const disabledTrigger = availableToBook
    ? false
    : {
        reason: "This asset has been marked as unavailable for bookings.",
      };

  const links = [
    {
      indexType: "asset",
      id: asset.id,
      disabled,
      label: "Create new booking",
      icon: "bookings",
      to: `/bookings/new?assetId=${asset.id}`,
    },
    {
      indexType: "asset",
      id: asset.id,
      label: "Add to existing booking",
      icon: "booking-exist",
      disabled,
      to: `overview/add-to-existing-booking`,
    },
  ] as BookLink[];

  return (
    <div className="actions-dropdown flex">
      <GenericBookActionsDropdown
        links={links}
        key={"asset"}
        label={"Book"}
        disabledTrigger={disabledTrigger}
      />
    </div>
  );
}
