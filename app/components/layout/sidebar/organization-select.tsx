import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "~/components/forms";
import { Button } from "~/components/shared";
import { Image } from "~/components/shared/image";
import ProfilePicture from "~/components/user/profile-picture";
import type { loader } from "~/routes/_layout+/_layout";
import { tw } from "~/utils";

export const OrganizationSelect = () => {
  const { organizations, currentOrganizationId } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  return (
    <fetcher.Form
      action={"/api/user/change-current-organization"}
      method="POST"
      onChange={(e) => {
        const form = e.currentTarget;
        fetcher.submit(form);
      }}
    >
      <Select name="organizationId" defaultValue={currentOrganizationId}>
        <SelectTrigger className="p-3">
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          position="popper"
          className="w-full min-w-[300px]"
          align="start"
        >
          <div className=" max-h-[320px] overflow-auto">
            {organizations.map((org) => (
              <SelectItem value={org.id} key={org.id} className="p-2">
                <div className="flex items-center gap-2">
                  {org.type === "PERSONAL" ? (
                    <ProfilePicture width="w-6" height="h-6" />
                  ) : (
                    <Image
                      imageId={org.imageId}
                      alt="img"
                      className={tw("h-6 w-6 rounded-[2px] object-cover")}
                    />
                  )}

                  <div className="ml-[3px] line-clamp-1 max-w-[265px] text-ellipsis text-sm text-gray-900">
                    {org.name}
                  </div>
                </div>
              </SelectItem>
            ))}
            <SelectSeparator className="mx-0" />
            <Button
              to="/settings/workspace"
              icon="settings"
              variant="link"
              className=" w-full select-none justify-start rounded-lg p-2 text-left font-medium text-gray-900 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-gray-50 hover:text-gray-800 "
            >
              Manage account
            </Button>
          </div>
        </SelectContent>
      </Select>
    </fetcher.Form>
  );
};
