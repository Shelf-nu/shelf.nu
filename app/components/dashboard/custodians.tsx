import { useLoaderData } from "@remix-run/react";
import type { TeamMemberWithUser } from "~/modules/team-member/types";
import type { loader } from "~/routes/_layout+/dashboard";
import { InfoTooltip } from "../shared/info-tooltip";
import { Table, Td, Th, Tr } from "../table";

export default function CustodiansList() {
  const { custodiansData } = useLoaderData<typeof loader>();

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
        {custodiansData.map((cd) => (
          <Tr key={cd.id}>
            {/**
             * @TODO this needs to be resolved. Its because of the createdAt & updatedAt fields.
             * We need a global solution for this as it happens everywhere
             *  @ts-ignore */}
            <Row custodian={cd.custodian} count={cd.count} />
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

function Row({
  custodian,
  count,
}: {
  custodian: TeamMemberWithUser;
  count: number;
}) {
  return (
    <>
      <Td className="w-full">
        <div className="flex items-center justify-between">
          <span className="text-text-sm font-medium text-gray-900">
            {custodian?.user ? (
              <img
                src={
                  custodian?.user?.profilePicture || "/images/default_pfp.jpg"
                }
                className="mr-1 h-4 w-4 rounded-full"
                alt=""
              />
            ) : null}
            <span className="mt-[1px]">{custodian.name}</span>
          </span>
          <span className="block text-gray-600">{count}</span>
        </div>
      </Td>
    </>
  );
}
