import type { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useAtom } from "jotai";
import { UserXIcon } from "~/components/icons";
import { LocationSelect } from "~/components/location/location-select";
import { Button } from "~/components/shared/button";
import { getAllRelatedEntries } from "~/modules/asset";
import { requireAuthSession } from "~/modules/auth";
import styles from "~/styles/layout/custom-modal.css";
import { isCustodianAssignedAtom } from "./assets.$assetId";

export const loader = async ({ request }: LoaderArgs) => {
  const { userId } = await requireAuthSession(request);
  const { locations } = await getAllRelatedEntries({
    userId,
  });
  const showModal = true;

  return json({
    showModal,
    locations,
  });
};

export function links() {
  return [{ rel: "stylesheet", href: styles }];
}

export default function Custody() {
  const [, setCustodianAssigned] = useAtom(isCustodianAssignedAtom);
  return (
    <>
      <div className="modal-content-wrapper">
        <div className="mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-gray-50 bg-gray-100 p-2 text-gray-600">
          <UserXIcon />
        </div>
        <div className="mb-5">
          <h4>Releasing custody</h4>
          <p>
            Are you sure you want to release{" "}
            <span className="font-medium">Carlos Virreira’s</span> custody over{" "}
            <span className="font-medium">Macbook Pro M1 14” (2021)</span>?
            Please specify the location you are releasing the asset to.
          </p>
        </div>
        <div className="mb-8">
          <LocationSelect />
        </div>
        <div className="flex gap-3">
          <Button to=".." variant="secondary" width="full">
            Cancel
          </Button>
          <Button
            variant="primary"
            width="full"
            to=".."
            onClick={() => setCustodianAssigned(false)}
          >
            Confirm
          </Button>
        </div>
      </div>
    </>
  );
}
