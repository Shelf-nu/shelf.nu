import { AuditStatus, OrganizationRoles } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { data, Form, Link, redirect, useLoaderData } from "react-router";
import { z } from "zod";

import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { DateS } from "~/components/shared/date";
import {
  getAuditSessionDetails,
  completeAuditSession,
} from "~/modules/audit/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error, getParams, payload } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const label = "Audit";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  {
    title: data ? appendToMetaTitle(data.header.title) : "Audit",
  },
];

export const handle = {
  breadcrumb: () => "Overview",
};

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
      action: PermissionAction.read,
    });

    const { organizationId, userOrganizations } = permissionResult;

    const { session, expectedAssets } = await getAuditSessionDetails({
      id: auditId,
      organizationId,
      userOrganizations,
      request,
    });

    const header: HeaderData = {
      title: `${session.name}'s overview`,
    };

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

    return data(
      payload({
        session,
        expectedAssets,
        isAdminOrOwner,
        header,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, auditId });
    throw data(error(reason), { status: reason.status });
  }
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const { userId } = context.getSession();
  const { auditId } = getParams(params, z.object({ auditId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.update,
    });

    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "complete-audit") {
      await completeAuditSession({
        sessionId: auditId,
        organizationId,
        userId,
      });

      return redirect(`/audits/${auditId}/results`);
    }

    throw new ShelfError({
      cause: null,
      message: "Invalid action intent",
      additionalData: { intent },
      label,
      status: 400,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, auditId });
    return data(error(reason), { status: reason.status });
  }
}

export default function AuditOverview() {
  const { session, expectedAssets, isAdminOrOwner, header } =
    useLoaderData<typeof loader>();

  const totalExpected = expectedAssets.length;
  const foundCount = session.foundAssetCount || 0;
  const missingCount = session.missingAssetCount || 0;
  const unexpectedCount = session.unexpectedAssetCount || 0;

  const isCompleted = session.status === AuditStatus.COMPLETED;
  const isActive = session.status === AuditStatus.ACTIVE;

  return (
    <>
      <Header title={header.title} subHeading={session.description || undefined} />

      <div className="mt-8 flex flex-col gap-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <StatCard label="Expected" value={totalExpected} color="blue" />
          <StatCard label="Found" value={foundCount} color="green" />
          <StatCard label="Missing" value={missingCount} color="yellow" />
          <StatCard label="Unexpected" value={unexpectedCount} color="red" />
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-3 sm:flex-row">
          {!isCompleted && (
            <Button asChild>
              <Link to="scan">
                {isActive ? "Continue scanning" : "Start scanning"}
              </Link>
            </Button>
          )}

          {isCompleted && (
            <Button asChild>
              <Link to="results">View results</Link>
            </Button>
          )}

          {!isCompleted && isAdminOrOwner && (
            <Form method="post">
              <input type="hidden" name="intent" value="complete-audit" />
              <Button
                type="submit"
                variant="secondary"
                disabled={foundCount === 0}
              >
                Complete audit
              </Button>
            </Form>
          )}
        </div>

        {/* Audit Details */}
        <Card className="mt-0 px-[-4] py-[-5] md:border">
          <h2 className="mb-4 border-b p-4 text-lg font-semibold">
            Audit Information
          </h2>
          <ul className="item-information">
            <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
              <span className="w-1/4 text-[14px] font-medium text-gray-900">
                Status
              </span>
              <div className="mt-1 w-3/5 text-gray-600 md:mt-0">
                {session.status}
              </div>
            </li>
            <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
              <span className="w-1/4 text-[14px] font-medium text-gray-900">
                Created
              </span>
              <div className="mt-1 w-3/5 text-gray-600 md:mt-0">
                <DateS
                  date={session.createdAt}
                  options={{ dateStyle: "short", timeStyle: "short" }}
                />
              </div>
            </li>
            {session.completedAt && (
              <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                <span className="w-1/4 text-[14px] font-medium text-gray-900">
                  Completed
                </span>
                <div className="mt-1 w-3/5 text-gray-600 md:mt-0">
                  <DateS
                    date={session.completedAt}
                    options={{ dateStyle: "short", timeStyle: "short" }}
                  />
                </div>
              </li>
            )}
            <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
              <span className="w-1/4 text-[14px] font-medium text-gray-900">
                Created by
              </span>
              <div className="mt-1 w-3/5 text-gray-600 md:mt-0">
                {session.createdBy.firstName} {session.createdBy.lastName}
              </div>
            </li>
          </ul>
        </Card>

        {/* Expected Assets List */}
        {expectedAssets.length > 0 && (
          <Card className="mt-0 px-[-4] py-[-5] md:border">
            <h2 className="mb-4 border-b p-4 text-lg font-semibold">
              Expected Assets ({expectedAssets.length})
            </h2>
            <ul className="item-information">
              {expectedAssets.map((expectedAsset) => (
                <li
                  key={expectedAsset.id}
                  className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0"
                >
                  <span className="text-[14px] font-medium text-gray-900">
                    {expectedAsset.name}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "blue" | "green" | "yellow" | "red";
}) {
  const colorClasses = {
    blue: "bg-blue-50 text-blue-700",
    green: "bg-green-50 text-green-700",
    yellow: "bg-yellow-50 text-yellow-700",
    red: "bg-red-50 text-red-700",
  };

  return (
    <div className={`rounded-lg border p-4 ${colorClasses[color]}`}>
      <div className="text-sm font-medium">{label}</div>
      <div className="mt-1 text-3xl font-bold">{value}</div>
    </div>
  );
}
