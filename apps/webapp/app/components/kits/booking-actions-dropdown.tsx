import { kitWithoutActiveAssetsReason } from "@shelf/labels";
import { useLoaderData } from "react-router";
import type { BookLink } from "~/components/shared/generic-add-to-bookings-actions-dropdown";
import { GenericBookActionsDropdown } from "~/components/shared/generic-add-to-bookings-actions-dropdown";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import type { loader } from "~/routes/_layout+/kits.$kitId";
import { isPersonalOrg } from "~/utils/organization";

export default function BookingActionsDropdown() {
  const { kit, archivedMemberCount } = useLoaderData<typeof loader>();
  const organization = useCurrentOrganization();

  if (isPersonalOrg(organization)) return null;

  // `kit.assetKits` holds the active members only: archived ones are left out
  // of kit bookings, so a kit whose members are all archived has nothing to
  // book, and an archived member never blocks the rest.
  const noAssets = kit.assetKits.length === 0;
  const someAssetIsNotAvailable = kit.assetKits.some(
    (ak) => !ak.asset.availableToBook
  );

  const disabled = noAssets
    ? {
        reason: kitWithoutActiveAssetsReason({
          hasArchivedAssets: archivedMemberCount > 0,
          action: "booking",
        }),
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
      to: "assets/create-new-booking",
    },
    {
      indexType: "kit",
      id: kit.id,
      label: "Add to existing booking",
      icon: "booking-exist",
      disabled,
      to: `/kits/${kit.id}/assets/add-to-existing-booking`,
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
