import { CustodySignatureStatus } from "@prisma/client";
import { json } from "@remix-run/node";
import type {
  MetaFunction,
  LoaderFunctionArgs,
  SerializeFrom,
} from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import CustodyReceiptDialog from "~/components/custody/custody-receipt-dialog";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { EmptyState } from "~/components/list/empty-state";
import { ListHeader } from "~/components/list/list-header";
import { ListItem } from "~/components/list/list-item";
import { Badge } from "~/components/shared/badge";
import { Table, Td, Th } from "~/components/table";
import { db } from "~/database/db.server";
import { useSearchParams } from "~/hooks/search-params";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { getDateTimeFormat } from "~/utils/client-hints";
import {
  CUSTODY_STATUS_COLOR,
  SIGN_STATUS_COLOR,
} from "~/utils/custody-agreement";
import { makeShelfError } from "~/utils/error";
import { data, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { resolveTeamMemberName } from "~/utils/user";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    const { organizationId, currentOrganization } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.receipts,
      action: PermissionAction.read,
    });

    let receipts = await db.custodyReceipt.findMany({
      where: { organizationId, agreement: { signatureRequired: true } },
      include: {
        asset: { select: { id: true, title: true } },
        custodian: {
          select: {
            id: true,
            name: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        agreement: {
          select: {
            id: true,
            name: true,
            // File with highest revision number is our latest file because we do not allow
            // further changes in agreement if any custody is signed.
            custodyAgreementFiles: {
              select: { url: true },
              orderBy: { revision: "desc" },
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
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

    const header: HeaderData = {
      title: "Receipts",
    };

    return json(
      data({
        header,
        items: receipts as Array<
          (typeof receipts)[number] & { requestedOn: string; signedOn: string }
        >,
        totalItems: receipts.length,
        organization: {
          name: currentOrganization.name,
        },
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
  const { items, totalItems } = useLoaderData<typeof loader>();
  const [_, setSearchParams] = useSearchParams();

  const hasItems = items.length > 0;

  return (
    <>
      <Header classNames="mb-4" />
      <CustodyReceiptDialog />

      <div className="flex w-full flex-col items-center rounded border bg-white">
        {!hasItems ? (
          <EmptyState
            customContent={{
              title: "No receipts found",
              text: "You do not have any receipts yet.",
            }}
            modelName={{
              singular: "receipt",
              plural: "receipts",
            }}
          />
        ) : (
          <>
            <div className="flex w-full items-center justify-between p-4">
              <div>
                <h3 className="text-md text-gray-900">Receipts</h3>
                <p className="text-sm text-gray-600">{totalItems} items</p>
              </div>
            </div>
            <div className="w-full flex-1 border-t">
              <Table>
                <ListHeader
                  hideFirstColumn
                  children={
                    <>
                      <Th>Asset</Th>
                      <Th>Custodian</Th>
                      <Th>Agreement</Th>
                      <Th>Signature status</Th>
                      <Th>Custody Status</Th>
                      <Th>Request Date</Th>
                      <Th>Signed Date</Th>
                    </>
                  }
                />
                <tbody>
                  {items.map((receipt) => (
                    <ListItem
                      item={receipt}
                      key={receipt.id}
                      navigate={(receiptId) => {
                        setSearchParams((prev) => {
                          prev.set("receiptId", receiptId);
                          return prev;
                        });
                      }}
                    >
                      <ReceiptRow item={receipt} />
                    </ListItem>
                  ))}
                </tbody>
              </Table>
            </div>
          </>
        )}
      </div>
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
      <Td>{item.asset.title}</Td>
      <Td>{resolveTeamMemberName(item.custodian)}</Td>
      <Td>{item?.agreement?.name}</Td>
      <Td>
        <Badge color={signColor}>{item.signatureStatus}</Badge>
      </Td>
      <Td>
        {item.signatureStatus === CustodySignatureStatus.PENDING ||
        item.signatureStatus === CustodySignatureStatus.CANCELLED ? (
          "-"
        ) : (
          <Badge color={custodyColor}>{item.custodyStatus}</Badge>
        )}
      </Td>
      <Td>{item.requestedOn}</Td>
      <Td>{item.signedOn ?? "-"}</Td>
    </>
  );
}
