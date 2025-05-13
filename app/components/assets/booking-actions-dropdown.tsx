import { useLoaderData } from "@remix-run/react";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import type { loader } from "~/routes/_layout+/assets.$assetId";
import { isPersonalOrg } from "~/utils/organization";
import { Button } from "../shared/button";
import type { BookLink } from "../shared/generic-add-to-bookings-actions-dropdown";
import { GenericBookActionsDropdown } from "../shared/generic-add-to-bookings-actions-dropdown";

export default function BookingActionsDropdown() {
  const { asset } = useLoaderData<typeof loader>();
  const organization = useCurrentOrganization();
  const { availableToBook } = asset;

  if (isPersonalOrg(organization)) return null;

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
      to: "overview/create-new-booking",
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
