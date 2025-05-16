import { useLoaderData } from "@remix-run/react";
import type { BookLink } from "~/components/shared/generic-add-to-bookings-actions-dropdown";
import { GenericBookActionsDropdown } from "~/components/shared/generic-add-to-bookings-actions-dropdown";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import type { loader } from "~/routes/_layout+/kits.$kitId";
import { isPersonalOrg } from "~/utils/organization";

export default function BookingActionsDropdown() {
  const { kit } = useLoaderData<typeof loader>();
  const organization = useCurrentOrganization();

  if (isPersonalOrg(organization)) return null;

  const noAssets = kit.assets.length === 0;
  const someAssetIsNotAvailable = kit.assets.some(
    (asset) => !asset.availableToBook
  );

  const disabled = noAssets
    ? {
        reason:
          "Kit has no assets. Please add some assets to be able to book this kit.",
      }
    : false;

  const disabledTrigger = someAssetIsNotAvailable
    ? {
        reason:
          "Some assets in this kit have been marked as unavailable for bookings.",
      }
    : false;

  const links = [
    {
      indexType: "kit",
      id: kit.id,
      disabled,
      label: "Create new booking",
      icon: "bookings",
      to: "create-new-booking",
    },
    {
      indexType: "kit",
      id: kit.id,
      label: "Add to existing booking",
      icon: "booking-exist",
      disabled,
      to: `/kits/${kit.id}/add-to-existing-booking`,
    },
  ] as BookLink[];

  return (
    <div className="actions-dropdown flex">
      <GenericBookActionsDropdown
        links={links}
        key={"kit"}
        label={"Book"}
        disabledTrigger={disabledTrigger}
      />
    </div>
  );
}
