import { useCallback, useEffect, useRef, useState } from "react";
import { OrganizationRoles } from "@prisma/client";
import type {
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useNavigate } from "@remix-run/react";
import { useAtom, useSetAtom } from "jotai";
import { addScannedItemAtom } from "~/atoms/qr-scanner";
import { ErrorContent } from "~/components/errors";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import type { OnQrDetectionSuccessProps } from "~/components/scanner/code-scanner";
import { CodeScanner } from "~/components/scanner/code-scanner";
import { scannerActionAtom } from "~/components/scanner/drawer/action-atom";
import { ActionSwitcher } from "~/components/scanner/drawer/action-switcher";
import { db } from "~/database/db.server";
import { hasGetAllValue } from "~/hooks/use-model-filters";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import { getTeamMemberForCustodianFilter } from "~/modules/team-member/service.server";
import scannerCss from "~/styles/scanner.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { error, getCurrentSearchParams } from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";
import type { AllowedModelNames } from "../api+/model-filters";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: scannerCss },
];

export type ScannerLoader = typeof loader;

// @TODO - to improve this we should place the action in the URL params and only fetch certain data depending on the action
export async function loader({ request, context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, role, isSelfServiceOrBase } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.asset,
        action: PermissionAction.read,
      });
    const header: HeaderData = {
      title: "Locations",
    };

    const searchParams = getCurrentSearchParams(request);
    const paramsValues = getParamsValues(searchParams);

    /** Get team members for form teamMember select */
    const { teamMemberIds } = paramsValues;
    const teamMemberData = await getTeamMemberForCustodianFilter({
      organizationId,
      selectedTeamMembers: teamMemberIds,
      getAll:
        searchParams.has("getAll") &&
        hasGetAllValue(searchParams, "teamMember"),
      filterByUserId: role === OrganizationRoles.SELF_SERVICE, // SElf service can only assign themselves and base users cant assign at all
      userId,
    });
    /** End team members */

    /** Get locations  */
    let locationsData;
    if (!isSelfServiceOrBase) {
      const locationSelected = searchParams.get("location") ?? "";
      const getAllEntries = searchParams.getAll(
        "getAll"
      ) as AllowedModelNames[];
      const [locationExcludedSelected, selectedLocation, totalLocations] =
        await Promise.all([
          db.location.findMany({
            where: { organizationId, id: { not: locationSelected } },
            take: getAllEntries.includes("location") ? undefined : 12,
          }),
          db.location.findMany({
            where: { organizationId, id: locationSelected },
          }),
          db.location.count({ where: { organizationId } }),
        ]);

      locationsData = {
        locations: [...selectedLocation, ...locationExcludedSelected],
        totalLocations,
      };
    }
    /** End locations */

    return json({
      header,
      ...teamMemberData,
      ...locationsData,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason), { status: reason.status });
  }
}

export const handle = {
  breadcrumb: () => <Link to="/scanner">QR code scanner</Link>,
};

export const meta: MetaFunction<typeof loader> = () => [
  { title: appendToMetaTitle("Qr code scanner") },
];

const QRScanner = () => {
  const navigate = useNavigate();
  const [paused, setPaused] = useState<boolean>(false);
  const [scanMessage, setScanMessage] = useState<string>(
    "Processing QR code..."
  );
  const { vh, isMd } = useViewportHeight();
  const height = isMd ? vh - 67 : vh - 102;
  const isNavigating = useRef(false);
  const addItem = useSetAtom(addScannedItemAtom);

  // Get action directly from the atom
  const [action] = useAtom(scannerActionAtom);

  // Store the current action in a ref that's always up-to-date
  // This is required in order to handle the action correctly, even tho we use global state
  const actionRef = useRef(action);

  // Update the ref whenever the action changes
  useEffect(() => {
    actionRef.current = action;

    // Reset the navigating state when action changes
    if (action !== "View asset") {
      isNavigating.current = false;
    }
  }, [action]);

  // Custom setPaused function that only pauses for "View asset"
  const handleSetPaused = useCallback(
    (value: boolean) => {
      // Always use the ref value for the most current action
      if (actionRef.current === "View asset") {
        setPaused(value);
      }
    },
    [] // No dependencies needed since we use the ref
  );

  // Define the handler using useCallback to prevent recreating it on every render
  const handleQrDetectionSuccess = useCallback(
    ({ qrId, error }: OnQrDetectionSuccessProps) => {
      // IMPORTANT: Always use the current value from the ref
      const currentAction = actionRef.current;

      if (currentAction === "View asset") {
        if (isNavigating.current) {
          return;
        }

        isNavigating.current = true;
        handleSetPaused(true);
        setScanMessage("Redirecting to mapped asset...");
        navigate(`/qr/${qrId}`);
      } else if (
        ["Assign custody", "Release custody", "Update location"].includes(
          currentAction
        )
      ) {
        addItem(qrId, error);
      }
    },
    [addItem, navigate, handleSetPaused] // action is not a dependency since we use the ref
  );

  return (
    <>
      <Header title="QR code scanner" hidePageDescription={true} />
      <div
        className="-mx-4 flex flex-col overflow-hidden"
        style={{ height: `${height}px` }}
      >
        <CodeScanner
          onQrDetectionSuccess={handleQrDetectionSuccess}
          paused={paused}
          setPaused={handleSetPaused}
          scanMessage={scanMessage}
          actionSwitcher={<ActionSwitcher />}
          scannerModeClassName={(mode) =>
            tw(mode === "scanner" && "justify-start pt-[100px]")
          }
        />
      </div>
    </>
  );
};

export default QRScanner;

export const ErrorBoundary = () => <ErrorContent />;
