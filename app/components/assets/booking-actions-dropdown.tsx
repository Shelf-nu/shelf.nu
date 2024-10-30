import { useLoaderData } from "@remix-run/react";
import type { loader } from "~/routes/_layout+/assets.$assetId";
import type { CustomLink } from "../shared/actions-dropdown";
import { ActionsDropDown } from "../shared/actions-dropdown";
import { Button } from "../shared/button";

export default function BookingActionsDropdown() {
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
      to: `overview/add-to-existing-booking`,
    },
  ] as CustomLink[];

  return (
    <div className="actions-dropdown flex">
      <ActionsDropDown
        links={links}
        key={"asset"}
        label={"Book Asset"}
        disabledReason={reason}
      />
    </div>
  );
}
