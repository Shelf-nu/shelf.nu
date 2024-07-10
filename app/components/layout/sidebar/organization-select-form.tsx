import { useEffect } from "react";
import { useFetcher } from "@remix-run/react";
import { useAtom } from "jotai";
import { switchingWorkspaceAtom } from "~/atoms/switching-workspace";

import { SelectSeparator } from "~/components/forms/select";
import { Button } from "~/components/shared/button";
import { isFormProcessing } from "~/utils/form";
import { OrganizationSelect } from "./organization-select";

export const OrganizationSelectForm = () => {
  const fetcher = useFetcher();

  /** We track if the fetcher is submitting */
  const isProcessing = isFormProcessing(fetcher.state);
  const [_workspaceSwitching, setWorkspaceSwitching] = useAtom(
    switchingWorkspaceAtom
  );
  useEffect(() => {
    setWorkspaceSwitching(isProcessing);
  }, [isProcessing, setWorkspaceSwitching]);

  return (
    <fetcher.Form
      action={"/api/user/change-current-organization"}
      method="POST"
      onChange={(e) => {
        const form = e.currentTarget;
        fetcher.submit(form);
      }}
    >
      <OrganizationSelect
        slots={{
          "after-select": (
            <>
              <SelectSeparator className="mx-0" />
              <Button
                to="/account-details/workspace"
                icon="settings"
                variant="link"
                className=" w-full select-none justify-start rounded p-2 text-left font-medium text-gray-900 outline-none  hover:bg-gray-50 hover:text-gray-800 "
              >
                Manage workspaces
              </Button>
            </>
          ),
        }}
      />
    </fetcher.Form>
  );
};
