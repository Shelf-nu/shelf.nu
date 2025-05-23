import Icon from "~/components/icons/icon";
import type { BulkAssignCustodySuccessMessageType } from "~/routes/api+/assets.bulk-assign-custody";

export const BULK_CUSTODY_SUCCESS_CONTENT: Record<
  BulkAssignCustodySuccessMessageType,
  (totalAssets: number) => React.ReactNode
> = {
  "user-with-sign": (totalAssets) => (
    <>
      <h3 className="mb-2">Bulk Custody Assignment - Action Required</h3>
      <p className="mb-4">
        You have assigned custody of multiple assets ({totalAssets}) to a user.
      </p>

      <p className="mb-4">
        <span className="font-bold">Important: </span>These assets will continue
        to appear as "available" until the agreements are signed. Look for the
        pending icon{" "}
        <div className="inline-flex items-center justify-center rounded-full bg-gray-200 p-2">
          <Icon icon="sign" size="xs" />
        </div>{" "}
        next to each asset.
      </p>

      <h5>To complete this process:</h5>
      <ol className="list-inside list-decimal">
        <li>
          An email notification has been sent to the user requesting their
          signature
        </li>
        <li>If needed, you can also visit each asset's page individually</li>
        <li>Locate and copy the agreement link for each asset</li>
        <li>Send these links to the user as an alternative way to sign</li>
      </ol>
    </>
  ),
  "user-without-sign": (totalAssets) => (
    <>
      <h3 className="mb-2">Bulk Custody Assignment - Action Required</h3>

      <p className="mb-2">
        You have assigned custody of multiple assets ({totalAssets}) to a user
        with a view-only agreement. These assets have been moved to "In Custody"
        status.
      </p>

      <p className="mb-4">
        <span className="font-bold">Important: </span>An email notification has
        been sent to the user with links to view the agreements. No signature is
        required for view-only agreements.
      </p>

      <h5 className="mb-2">To manually share these agreements if needed:</h5>
      <ol className="list-inside list-decimal">
        <li>Visit each asset's page individually</li>
        <li>Local and copy the view-only agreement link for each asset</li>
        <li>Send these links to the user to review</li>
      </ol>
    </>
  ),
  "nrm-with-sign": (totalAssets) => (
    <>
      <h3 className="mb-2">Bulk Custody Assignment - Action Required</h3>

      <p className="mb-2">
        You assigned custody of multiple assets ({totalAssets}) to a
        non-registered member (NRM). SInce this member doesn't have an email in
        the system, you need to manually share the agreement links.
      </p>

      <p className="mb-4">
        <span className="font-bold">Important: </span>These assets will continue
        to appear as "available" until the agreements are signed. Look for the
        pending icon{" "}
        <div className="inline-flex items-center justify-center rounded-full bg-gray-200 p-2">
          <Icon icon="sign" size="xs" />
        </div>{" "}
        next to each asset.
      </p>

      <h5>To complete this process:</h5>
      <ol className="list-inside list-decimal">
        <li>Visit each asset's page individually</li>
        <li>Locate and copy the agreement link for each asset</li>
        <li>Send these links to the NRM for signing</li>
      </ol>
    </>
  ),
  "nrm-without-sign": (totalAssets) => (
    <>
      <h3 className="mb-2">Bulk Custody Assignment - Action Required</h3>

      <p className="mb-2">
        You have assigned custody of multiple assets ({totalAssets}) to a
        non-registered member (NRM) with view-only agreement. These assets have
        been moved to "In Custody" status.
      </p>

      <p className="mb-4">
        <span className="font-bold">Important: </span>Since this member doesn't
        have an email in the system, you need to manually share the view-only
        agreement link.s The recipient only need s to view these agreements - no
        signature is required.
      </p>

      <h5 className="mb-2">To complete this process:</h5>
      <ol className="list-inside list-decimal">
        <li>Visit each asset's page individually</li>
        <li>Locate and copy the view-only agreement link for each asset</li>
        <li>Send these links to the NRM to review</li>
      </ol>
    </>
  ),
};
