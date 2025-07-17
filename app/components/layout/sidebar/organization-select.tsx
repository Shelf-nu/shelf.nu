import type { ReactNode } from "react";
import { useLoaderData } from "@remix-run/react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/forms/select";
import { Image } from "~/components/shared/image";
import ProfilePicture from "~/components/user/profile-picture";
import type { loader } from "~/routes/_layout+/_layout";
import { tw } from "~/utils/tw";

type SlotKeys = "after-select";

export const OrganizationSelect = ({
  slots,
  className,
}: {
  slots?: Record<SlotKeys, ReactNode>;
  /** Class applied inside the SelectContent */
  className?: string;
}) => {
  const { organizations, currentOrganizationId } =
    useLoaderData<typeof loader>();
  return (
    <Select name="organizationId" defaultValue={currentOrganizationId}>
      <SelectTrigger className="w-full px-3 py-2">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" className="w-full" align="start">
        <div className={tw("max-h-[320px] w-[253px] overflow-auto", className)}>
          {organizations.map((org) => (
            <SelectItem
              value={org.id}
              key={org.id}
              className="flex cursor-pointer select-none items-center justify-between gap-4  py-2 outline-none  hover:bg-color-100 focus:bg-color-100"
            >
              <div className="flex items-center gap-2">
                {org.type === "PERSONAL" ? (
                  <ProfilePicture width="w-6" height="h-6" />
                ) : (
                  <Image
                    imageId={org.imageId}
                    alt="img"
                    className={tw("size-6 rounded-[2px] object-cover")}
                    updatedAt={org.updatedAt}
                  />
                )}

                <div className="ml-[3px] line-clamp-1 max-w-[265px] text-ellipsis text-left text-sm text-color-900">
                  {org.name}
                </div>
              </div>
            </SelectItem>
          ))}
          {slots?.["after-select"] || null}
        </div>
      </SelectContent>
    </Select>
  );
};
