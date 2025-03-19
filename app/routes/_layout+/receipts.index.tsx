import { CustodySignatureStatus } from "@prisma/client";
import { json } from "@remix-run/node";
import type {
  MetaFunction,
  LoaderFunctionArgs,
  SerializeFrom,
} from "@remix-run/node";
import CustodyReceiptDialog from "~/components/custody/custody-receipt-dialog";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { ListContentWrapper } from "~/components/list/content-wrapper";
import { Filters } from "~/components/list/filters";
import { Badge } from "~/components/shared/badge";
import { Td, Th } from "~/components/table";
import { useSearchParams } from "~/hooks/search-params";
import { getPaginatedAndFilterableReceipts } from "~/modules/custody-receipt/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { getDateTimeFormat } from "~/utils/client-hints";
import {
  CUSTODY_STATUS_COLOR,
  SIGN_STATUS_COLOR,
} from "~/utils/custody-agreement";
import { makeShelfError } from "~/utils/error";
import { data, error } from "~/utils/http.server";
import { formatEnum } from "~/utils/misc";
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

    let { receipts, page, perPage, search, totalPages, totalReceipts } =
      await getPaginatedAndFilterableReceipts({
        organizationId,
        request,
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

  return (
    <>
      <Header classNames="mb-4" />
      <CustodyReceiptDialog />

      <ListContentWrapper>
        <Filters />

        <List
          hideFirstHeaderColumn
          headerChildren={
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
      <Td>{item.asset.title}</Td>
      <Td>{resolveTeamMemberName(item.custodian)}</Td>
      <Td>{item?.agreement?.name}</Td>
      <Td>
        <Badge color={signColor}>{formatEnum(item.signatureStatus)}</Badge>
      </Td>
      <Td>
        {item.signatureStatus === CustodySignatureStatus.PENDING ||
        item.signatureStatus === CustodySignatureStatus.CANCELLED ? (
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
