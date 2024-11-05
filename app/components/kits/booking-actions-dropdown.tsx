import { useLoaderData } from "@remix-run/react";
import type { BookLink } from "~/components/shared/generic-add-to-bookings-actions-dropdown";
import { GenericBookActionsDropdown } from "~/components/shared/generic-add-to-bookings-actions-dropdown";
import type { loader } from "~/routes/_layout+/kits.$kitId";

export default function BookingActionsDropdown() {
  const { kit } = useLoaderData<typeof loader>();

  const noAssets = kit.assets.length === 0;

  const disabled = noAssets
    ? {
        reason:
          "Kit has no assets. Please add some assets to be able to book this kit.",
      }
    : false;
  const links = [
    {
      indexType: "kit",
      id: kit.id,
      disabled,
      label: "Create new booking",
      icon: "bookings",
      to: `/bookings/new?${kit.assets.map((a) => `assetId=${a.id}`).join("&")}`,
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
      <GenericBookActionsDropdown links={links} key={"Kit"} label={"Book"} />
    </div>
  );
}
