import { json } from "@remix-run/node";
import { useAtom } from "jotai";
import CustodianSelect from "~/components/custody/custodian-select";
import { UserIcon } from "~/components/icons";
import { Button } from "~/components/shared/button";
import styles from "~/styles/layout/custom-modal.css";
import { isCustodianAssignedAtom } from "./assets.$assetId";

export const loader = async () => {
  const showModal = true;

  return json({
    showModal,
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
          <UserIcon />
        </div>
        <div className="mb-5">
          <h4>Give Custody</h4>
          <p>
            This asset is currently available. You’re about to give custody to
            one of your team members.
          </p>
        </div>
        <div className="mb-8">
          <CustodianSelect />
        </div>
        <div className="flex gap-3">
          <Button to=".." variant="secondary" width="full">
            Cancel
          </Button>
          <Button
            variant="primary"
            width="full"
            to=".."
            onClick={() => setCustodianAssigned(true)}
          >
            Confirm
          </Button>
        </div>
      </div>
    </>
  );
}
