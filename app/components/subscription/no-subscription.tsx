import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useUserData } from "~/hooks/use-user-data";
import { CustomerPortalForm } from "./customer-portal-form";
import { plansIconsMap } from "./price-box";
import { Button } from "../shared/button";

export const NoSubscription = () => {
  const currentOrganization = useCurrentOrganization();
  const user = useUserData();

  const userIsOwner = user?.id === currentOrganization?.owner.id;

  return (
    <div className="flex size-full items-center justify-center">
      <div className="text-center">
        <div className="bg-primary-100 mb-2 inline-flex scale-125 items-center justify-center rounded-full border-[5px] border-solid border-primary-50 p-1.5 text-primary">
          <i className=" inline-flex min-h-[30px] min-w-[30px] items-center justify-center">
            {plansIconsMap["tier_2"]}
          </i>
        </div>
        <h2 className="mb-2">Workspace disabled</h2>
        <p className="max-w-[550px] text-color-600">
          {userIsOwner
            ? "The subscription for this workspace has expired and is therefore set to inactive. Renew your subscription to start using this Team workspace again."
            : "The subscription for this workspace has expired and is therefore set to inactive. Please contact the owner of the workspace for more information."}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          {userIsOwner && (
            <CustomerPortalForm buttonText={"Manage subscription"} />
          )}
          <Button
            to={`mailto:${currentOrganization?.owner.email}`}
            variant="secondary"
          >
            Contact owner
          </Button>
        </div>
      </div>
    </div>
  );
};
