import { useMemo, useState } from "react";
import type { OrganizationType } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/forms";
import ProfilePicture from "~/components/user/profile-picture";
import type { loader } from "~/routes/_layout+/_layout";
import { tw } from "~/utils";

export const OrganizationSelect = () => {
  const { organizations, currentOrganizationId } =
    useLoaderData<typeof loader>();

  return (
    <Select name={`currentOrganizationId`} value={currentOrganizationId}>
      <SelectTrigger className="px-3.5 py-3">
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        position="popper"
        className="w-full min-w-[300px]"
        align="start"
      >
        <div className=" max-h-[320px] overflow-auto">
          {organizations.map(
            (org: { id: string; name: string; type: OrganizationType }) => (
              <SelectItem value={org.id} key={org.id}>
                <div
                  className={tw(
                    "flex justify-center gap-2"
                    // !shouldShowFullSelect ? "ml-[-5px] w-[24px]" : ""
                  )}
                >
                  {org.type === "PERSONAL" ? (
                    <ProfilePicture width="w-6" height="h-6" />
                  ) : null}
                  {/* {shouldShowFullSelect ? ( */}
                  <div className=" text-[16px] text-gray-900">{org.name}</div>
                  {/* // ) : null} */}
                </div>
              </SelectItem>
            )
          )}
        </div>
      </SelectContent>
    </Select>
  );
};
