import { useLoaderData } from "@remix-run/react";
import type { loader } from "~/routes/_layout+/dashboard";
import { resolveTeamMemberName } from "~/utils/user";
import { EmptyState } from "./empty-state";
import { InfoTooltip } from "../shared/info-tooltip";
import { Table, Td, Tr } from "../table";

export default function CustodiansList() {
  const { custodiansData } = useLoaderData<typeof loader>();

  return (
    <>
      <div className="rounded-t border border-b-0 border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex-1 p-4 text-left text-[14px] font-semibold  text-gray-900 md:px-6">
            Top custodians
          </div>
          <div className=" p-4 text-right text-[14px] font-semibold  text-gray-900 md:px-6">
            <InfoTooltip
              content={
                <>
                  <h6>Custodians</h6>
                  <p>Below listed custodians currently hold the most assets</p>
                </>
              }
            />
          </div>
        </div>
      </div>

      {custodiansData.length > 0 ? (
        <Table className="h-full rounded border  border-gray-200 p-8">
          <tbody>
            {custodiansData.map((cd) => (
              <Tr key={cd.id} className="h-[72px]">
                <Row custodian={cd.custodian} count={cd.count} />
              </Tr>
            ))}
            {custodiansData.length < 5 &&
              Array(5 - custodiansData.length)
                .fill(null)
                .map((_d, i) => (
                  <Tr key={i} className="h-[72px]">
                    {""}
                  </Tr>
                ))}
          </tbody>
        </Table>
      ) : (
        <div className="h-full flex-1 rounded-b border border-gray-200 p-8">
          <EmptyState text="No assets in custody" />
        </div>
      )}
    </>
  );
}

function Row({
  custodian,
  count,
}: {
  custodian: {
    name: string;
    user?: {
      firstName?: string | null;
      lastName?: string | null;
      profilePicture?: string | null;
    } | null;
  };
  count: number;
}) {
  return (
    <>
      <Td className="w-full">
        <div className="flex items-center justify-between">
          <span className="text-text-sm font-medium text-gray-900">
            <div className="flex items-center gap-3">
              <img
                src={
                  custodian?.user?.profilePicture
                    ? custodian?.user?.profilePicture
                    : "/static/images/default_pfp.jpg"
                }
                className={"size-10 rounded-[4px]"}
                alt={`${resolveTeamMemberName(custodian)}'s profile`}
              />
              <div>
                <span className="mt-px">
                  {resolveTeamMemberName(custodian)}
                </span>
                <span className="block text-gray-600">{count} Assets</span>
              </div>
            </div>
          </span>
        </div>
      </Td>
      <Td>{""}</Td>
    </>
  );
}
