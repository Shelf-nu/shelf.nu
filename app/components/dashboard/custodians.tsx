import { useLoaderData } from "@remix-run/react";
import type {
  TeamMemberWithCustodies,
  loader,
} from "~/routes/_layout+/settings.workspace";
import { InfoTooltip } from "../shared/info-tooltip";
import { Table, Td, Th, Tr } from "../table";

export default function CustodiansList() {
  const { custodians } = useLoaderData<typeof loader>();
  return (
    <Table className="rounded border border-gray-200">
      <thead>
        <tr>
          <Th className="hidden text-[14px] font-semibold text-gray-900 md:table-cell">
            Custodians
          </Th>
          <Th className="text-right">
            <InfoTooltip
              content={
                <>
                  <h6>Custodians</h6>
                  <p>Below listed assets were created recently</p>
                </>
              }
            />
          </Th>
        </tr>
      </thead>
      <tbody>
        {custodians.map((custodian) => (
          <Tr key={custodian.id}>
            <Row item={custodian} />
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

function Row({ item }: { item: TeamMemberWithCustodies }) {
  return (
    <>
      <Td className="w-full">
        <div className="flex items-center justify-between">
          <span className="text-text-sm font-medium text-gray-900">
            {item.name}
          </span>
          <span className="block text-gray-600">23 Assets</span>
        </div>
      </Td>
    </>
  );
}
