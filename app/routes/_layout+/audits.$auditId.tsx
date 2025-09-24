import { useEffect, useMemo } from "react";
import { OrganizationRoles } from "@prisma/client";
import type {
  LoaderFunctionArgs,
  MetaFunction,
  LinksFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useSetAtom } from "jotai";
import { z } from "zod";

import {
  setAuditExpectedAssetsAtom,
  startAuditSessionAtom,
  endAuditSessionAtom,
  type AuditScannedItem,
} from "~/atoms/qr-scanner";
import AuditDrawer from "~/components/audit/audit-drawer";
import Header from "~/components/layout/header";
import { getAuditSessionDetails } from "~/modules/audit/service.server";
import auditStyles from "~/styles/assets.css?url";
import { makeShelfError, ShelfError } from "~/utils/error";
import { data, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: auditStyles },
];

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  {
    title: data ? `Audit · ${data.session.name}` : "Audit",
  },
];

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { auditId } = getParams(params, z.object({ auditId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const permissionResult = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.update,
    });

    const { organizationId, userOrganizations } = permissionResult;

    const { session, expectedAssets } = await getAuditSessionDetails({
      id: auditId,
      organizationId,
    });

    const rolesForOrg = userOrganizations.find(
      (org) => org.organization.id === organizationId
    )?.roles;

    const isAdminOrOwner = rolesForOrg
      ? rolesForOrg.includes(OrganizationRoles.ADMIN) ||
        rolesForOrg.includes(OrganizationRoles.OWNER)
      : false;

    if (!isAdminOrOwner) {
      const isAssignee = session.assignments.some(
        (assignment) => assignment.userId === userId
      );

      if (!isAssignee) {
        throw new ShelfError({
          cause: null,
          message: "You are not assigned to this audit.",
          additionalData: { auditId, userId },
          status: 403,
          label,
        });
      }
    }

    return json(data({ session, expectedAssets }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, auditId });
    throw json(error(reason), { status: reason.status });
  }
}

const label = "Audit" as const;

export default function AuditSessionRoute() {
  const { session, expectedAssets } = useLoaderData<typeof loader>();
  const startAuditSession = useSetAtom(startAuditSessionAtom);
  const setExpectedAssets = useSetAtom(setAuditExpectedAssetsAtom);
  const endAuditSession = useSetAtom(endAuditSessionAtom);

  const expectedItems: AuditScannedItem[] = useMemo(
    () =>
      expectedAssets.map(
        (asset) =>
          ({
            id: asset.id,
            name: asset.name,
            type: "asset",
            auditStatus: "missing",
          }) as AuditScannedItem
      ),
    [expectedAssets]
  );

  useEffect(() => {
    const scopeMeta =
      typeof session.scopeMeta === "object" && session.scopeMeta
        ? (session.scopeMeta as Record<string, unknown>)
        : null;

    startAuditSession({
      id: session.id,
      name: session.name,
      targetId: session.targetId,
      contextType:
        (scopeMeta?.contextType as string | undefined) ?? "SELECTION",
      contextName:
        (scopeMeta?.contextName as string | undefined) ?? session.name,
      expectedAssetCount: session.expectedAssetCount,
      foundAssetCount: session.foundAssetCount,
      missingAssetCount: session.missingAssetCount,
      unexpectedAssetCount: session.unexpectedAssetCount,
    });

    setExpectedAssets(expectedItems);

    return () => {
      endAuditSession();
    };
  }, [
    endAuditSession,
    expectedItems,
    session.expectedAssetCount,
    session.foundAssetCount,
    session.id,
    session.missingAssetCount,
    session.name,
    session.targetId,
    session.unexpectedAssetCount,
    session.scopeMeta,
    setExpectedAssets,
    startAuditSession,
  ]);

  const scopeMeta =
    typeof session.scopeMeta === "object" && session.scopeMeta
      ? (session.scopeMeta as Record<string, unknown>)
      : null;

  const contextLabel =
    typeof scopeMeta?.contextType === "string"
      ? (scopeMeta.contextType as string)
      : "Selection";

  const contextName =
    typeof scopeMeta?.contextName === "string"
      ? (scopeMeta.contextName as string)
      : session.name;

  return (
    <div className="relative">
      <Header hidePageDescription>
        <h1 className="text-lg font-semibold text-gray-900">{session.name}</h1>
      </Header>

      <AuditDrawer
        contextLabel={contextLabel}
        contextName={contextName}
        expectedAssets={expectedItems}
        defaultExpanded
      />
    </div>
  );
}
