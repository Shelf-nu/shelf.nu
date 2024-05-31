import { OrganizationRoles } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import { organizationRolesMap } from "~/routes/_layout+/settings.team";
import type { loader } from "~/routes/_layout+/settings.workspace.$workspaceId.edit";
import FormRow from "../forms/form-row";
import Input from "../forms/input";

export const SSOFormFields = () => {
  const { organization } = useLoaderData<typeof loader>();
  /** Getting the relevant roles that can be mapped to groups */
  const roles = [OrganizationRoles.ADMIN, OrganizationRoles.SELF_SERVICE];

  return organization.enabledSso && organization.ssoDetails ? (
    <div>
      <div className=" border-b pb-5">
        <h2 className=" text-[18px] font-semibold">SSO details</h2>
      </div>

      <FormRow
        rowLabel={"SSO Domain"}
        className="border-b-0 pb-[10px]"
        subHeading={
          "The domain that this workspace is linked to. If you want it changed, please contact support."
        }
      >
        <Input
          label="SSO Domain"
          hideLabel
          disabled={true}
          className="disabled w-full"
          defaultValue={organization.ssoDetails.domain}
        />
      </FormRow>

      {roles.map((role) => {
        const friendlyName = organizationRolesMap[role];
        return (
          <FormRow
            rowLabel={`${friendlyName} group id`}
            subHeading={
              <div>
                Place the Id of the group that should be mapped to the{" "}
                <b>{friendlyName}</b> role.
              </div>
            }
            className="border-b-0 pb-[10px]"
            key={role}
          >
            <Input label={"SSO Domain"} hideLabel className="w-full" />
          </FormRow>
        );
      })}
    </div>
  ) : null;
};
