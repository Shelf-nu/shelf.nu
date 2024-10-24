import { useLoaderData } from "@remix-run/react";
import { ActionsDropDown } from "~/components/shared/actions-dropdown";
import type { CustomLink } from "~/components/shared/actions-dropdown";
import type { loader } from "~/routes/_layout+/kits.$kitId";

export default function BookingActionsDropdown() {
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
  ] as CustomLink[];

  return (
    <div className="actions-dropdown flex">
      <ActionsDropDown
        links={links}
        key={"Kit"}
        label={"Book Kit"}
        disabledReason={reason}
      />
    </div>
  );
}
