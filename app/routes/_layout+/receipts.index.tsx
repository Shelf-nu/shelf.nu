import { CustodySignatureStatus, CustodyStatus } from "@prisma/client";
import { json } from "@remix-run/node";
import type {
  MetaFunction,
  LoaderFunctionArgs,
  SerializeFrom,
} from "@remix-run/node";
import { ChevronDown } from "lucide-react";
import CustodyReceiptDialog from "~/components/custody/custody-receipt-dialog";
import DynamicDropdown from "~/components/dynamic-dropdown/dynamic-dropdown";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { ListContentWrapper } from "~/components/list/content-wrapper";
import { Filters } from "~/components/list/filters";
import Select from "~/components/select/select";
import { Badge } from "~/components/shared/badge";
import { Td, Th } from "~/components/table";
import { db } from "~/database/db.server";
import { useSearchParams } from "~/hooks/search-params";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { getPaginatedAndFilterableReceipts } from "~/modules/custody-receipt/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { getDateTimeFormat } from "~/utils/client-hints";
import {
  CUSTODY_STATUS_COLOR,
  SIGN_STATUS_COLOR,
} from "~/utils/custody-agreement";
import { makeShelfError } from "~/utils/error";
import { data, error, getCurrentSearchParams } from "~/utils/http.server";
import { formatEnum } from "~/utils/misc";
import type { OrganizationPermissionSettings } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import { userHasCustodyViewPermission } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { resolveTeamMemberName } from "~/utils/user";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    const {
      organizationId,
      currentOrganization,
      isSelfServiceOrBase,
      canSeeAllCustody,
    } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.receipts,
      action: PermissionAction.read,
    });

    let { receipts, page, perPage, search, totalPages, totalReceipts } =
      await getPaginatedAndFilterableReceipts({
        organizationId,
        request,
        userId,
        isSelfServiceOrBase,
      });

    const datetime = getDateTimeFormat(request, {
      dateStyle: "short",
      timeStyle: "short",
    });

    receipts = receipts.map((receipt) => ({
      ...receipt,
      requestedOn: datetime.format(receipt.createdAt),
      signedOn: receipt.agreementSignedOn
        ? datetime.format(receipt.agreementSignedOn)
        : undefined,
    }));

    const searchParams = getCurrentSearchParams(request);

    /**
     * Filters data
     */
    const [
      assets,
      totalAssets,
      teamMembers,
      totalTeamMembers,
      kits,
      totalKits,
      agreements,
      totalAgreements,
    ] = await Promise.all([
      /** Assets */
      db.asset.findMany({
        where: { organizationId },
        select: { id: true, title: true },
        take: searchParams.get("getAll") === "asset" ? undefined : 12,
      }),
      /** Total assets */
      db.asset.count({ where: { organizationId } }),

      /** Team members/Custodian */
      db.teamMember.findMany({
        where: {
          deletedAt: null,
          organizationId,
          userId: !canSeeAllCustody ? userId : undefined,
        },
        include: { user: true },
        take: searchParams.get("getAll") === "teamMember" ? undefined : 12,
      }),
      /** Total team members */
      db.teamMember.count({
        where: {
          deletedAt: null,
          organizationId,
          userId: !canSeeAllCustody ? userId : undefined,
        },
      }),

      /** Kits */
      db.kit.findMany({
        where: { organizationId },
        select: { id: true, name: true },
        take: searchParams.get("getAll") === "kit" ? undefined : 12,
      }),
      db.kit.count({
        where: { organizationId },
      }),

      /** Agreements */
      db.custodyAgreement.findMany({
        where: { organizationId },
        select: { id: true, name: true },
        take:
          searchParams.get("getAll") === "custodyAgreement" ? undefined : 12,
      }),
      db.custodyAgreement.count({
        where: { organizationId },
      }),
    ]);

    const header: HeaderData = {
      title: "Receipts",
      subHeading:
        "View the receipts of all your signed custodies. If a custody required a signature, you can click on the receipt to view the signed document.",
    };

    const modelName = {
      singular: "receipt",
      plural: "receipts",
    };

    return json(
      data({
        header,
        items: receipts as Array<
          (typeof receipts)[number] & { requestedOn: string; signedOn: string }
        >,
        totalItems: totalReceipts,
        perPage,
        page,
        search,
        totalPages,
        modelName,
        organization: {
          name: currentOrganization.name,
        },
        teamMembers,
        totalTeamMembers,
        assets,
        totalAssets,
        kits,
        totalKits,
        agreements,
        totalAgreements,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export default function Receipts() {
  const [_, setSearchParams] = useSearchParams();
  const { roles } = useUserRoleHelper();
  const organization = useCurrentOrganization();

  const canReadCustody = userHasCustodyViewPermission({
    roles,
    organization: organization as OrganizationPermissionSettings,
  });

  return (
    <>
      <Header classNames="mb-4" />
      <CustodyReceiptDialog />

      <ListContentWrapper>
        <Filters
          slots={{
            "left-of-search": (
              <div className="flex items-center gap-2">
                <Select
                  className="py-2.5"
                  placeholder="Signature status"
                  strategy="searchParams"
                  paramKey="signatureStatus"
                  labelKey="label"
                  valueKey="value"
                  items={[
                    { label: "All", value: "ALL" },
                    ...Object.keys(CustodySignatureStatus).map(
                      (signStatus) => ({
                        label: formatEnum(signStatus),
                        value: signStatus,
                      })
                    ),
                  ]}
                />

                <Select
                  className="py-2.5"
                  placeholder="Custody status"
                  strategy="searchParams"
                  paramKey="custodyStatus"
                  labelKey="label"
                  valueKey="value"
                  items={[
                    { label: "All", value: "ALL" },
                    ...Object.keys(CustodyStatus).map((signStatus) => ({
                      label: formatEnum(signStatus),
                      value: signStatus,
                    })),
                  ]}
                />
              </div>
            ),
          }}
          searchClassName="text-sm"
        >
          <div className="flex items-center gap-2">
            <DynamicDropdown
              trigger={
                <div className="my-2 flex cursor-pointer items-center gap-2 md:my-0">
                  Asset <ChevronDown className="hidden size-4 md:inline" />
                </div>
              }
              model={{ name: "asset", queryKey: "title" }}
              label="Filter by asset"
              placeholder="Search asset"
              countKey="totalAssets"
              initialDataKey="assets"
              renderItem={(item) => item?.name ?? item?.title}
            />

            <DynamicDropdown
              trigger={
                <div className="my-2 flex cursor-pointer items-center gap-2 md:my-0">
                  Kit <ChevronDown className="hidden size-4 md:inline" />
                </div>
              }
              model={{ name: "kit", queryKey: "name" }}
              label="Filter by kit"
              placeholder="Search kit"
              countKey="totalKits"
              initialDataKey="kits"
            />

            {canReadCustody && (
              <DynamicDropdown
                trigger={
                  <div className="my-2 flex cursor-pointer items-center gap-2 md:my-0">
                    Custodian{" "}
                    <ChevronDown className="hidden size-4 md:inline" />
                  </div>
                }
                model={{
                  name: "teamMember",
                  queryKey: "name",
                  deletedAt: null,
                }}
                label="Filter by custodian"
                placeholder="Search team members"
                countKey="totalTeamMembers"
                initialDataKey="teamMembers"
                transformItem={(item) => ({
                  ...item,
                  id: item.metadata?.userId ? item.metadata.userId : item.id,
                })}
                renderItem={(item) => resolveTeamMemberName(item, true)}
              />
            )}

            <DynamicDropdown
              trigger={
                <div className="my-2 flex cursor-pointer items-center gap-2 md:my-0">
                  Agreement <ChevronDown className="hidden size-4 md:inline" />
                </div>
              }
              model={{ name: "custodyAgreement", queryKey: "name" }}
              label="Filter by agreement"
              placeholder="Search agreement"
              countKey="totalAgreements"
              initialDataKey="agreements"
            />
          </div>
        </Filters>

        <List
          hideFirstHeaderColumn
          headerChildren={
            <>
              <Th>Asset</Th>
              <Th>Kit</Th>
              <Th>Custodian</Th>
              <Th>Agreement</Th>
              <Th>Signature status</Th>
              <Th>Custody Status</Th>
              <Th>Request Date</Th>
              <Th>Signed Date</Th>
            </>
          }
          navigate={(receiptId) => {
            setSearchParams((prev) => {
              prev.set("receiptId", receiptId);
              return prev;
            });
          }}
          ItemComponent={ReceiptRow}
        />
      </ListContentWrapper>
    </>
  );
}

function ReceiptRow({
  item,
}: {
  item: SerializeFrom<typeof loader>["items"][number];
}) {
  const signColor = SIGN_STATUS_COLOR[item.signatureStatus];
  const custodyColor = CUSTODY_STATUS_COLOR[item.custodyStatus];

  return (
    <>
      <Td>{item?.asset?.title ?? "-"}</Td>
      <Td>{item?.kit?.name ?? "-"}</Td>
      <Td>{resolveTeamMemberName(item.custodian)}</Td>
      <Td>{item?.agreement?.name}</Td>
      <Td>
        <Badge color={signColor}>
          {item.signatureStatus === CustodySignatureStatus.NOT_REQUIRED
            ? "View only agreement"
            : formatEnum(item.signatureStatus)}
        </Badge>
      </Td>
      <Td>
        {item.signatureStatus === CustodySignatureStatus.PENDING ? (
          "-"
        ) : (
          <Badge color={custodyColor}>{formatEnum(item.custodyStatus)}</Badge>
        )}
      </Td>
      <Td>{item.requestedOn}</Td>
      <Td>{item.signedOn ?? "-"}</Td>
    </>
  );
}
