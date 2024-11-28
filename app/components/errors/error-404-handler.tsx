import { useMemo } from "react";
import { tw } from "~/utils/tw";
import { Error404AdditionalData, getModelLabelForEnumValue } from "./utils";
import { Button } from "../shared/button";
import { useFetcher } from "@remix-run/react";
import { isFormProcessing } from "~/utils/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms/select";

export type Error404HandlerProps = {
  className?: string;
  style?: React.CSSProperties;
  additionalData: Error404AdditionalData;
};

export default function Error404Handler({
  className,
  style,
  additionalData,
}: Error404HandlerProps) {
  const fetcher = useFetcher();
  const disabled = isFormProcessing(fetcher.state);

  const content = useMemo(() => {
    switch (additionalData.model) {
      case "asset":
      case "kit":
      case "location":
      case "booking":
      case "customField": {
        const modelLabel = getModelLabelForEnumValue(additionalData.model);

        return (
          <div className="flex flex-col items-center text-center">
            <div className="w-full md:max-w-screen-sm">
              <h2 className="mb-2">
                <span className="capitalize">{modelLabel}</span> belongs to
                another workspace.
              </h2>
              <p className="mb-4">
                The {modelLabel} you are trying to view belongs to a different
                workspace you are part of. Would you like to switch to workspace{" "}
                <span className="font-bold">
                  "{additionalData.organization.organization.name}"
                </span>{" "}
                to view the {modelLabel}?
              </p>
              <fetcher.Form
                action="/api/user/change-current-organization"
                method="POST"
              >
                <input
                  type="hidden"
                  name="organizationId"
                  value={additionalData.organization.organization.id}
                />
                <input
                  type="hidden"
                  name="redirectTo"
                  value={additionalData.redirectTo}
                />
                <Button disabled={disabled}>Switch workspace</Button>
              </fetcher.Form>
            </div>
          </div>
        );
      }

      /**
       * User can have a teamMember in multiple organizations, so in this case we
       * show a Select to choose from the organization and switch to that.
       **/
      case "teamMember": {
        return (
          <div className="flex flex-col items-center text-center">
            <div className="w-full md:max-w-screen-sm">
              <h2 className="mb-2">
                <span className="capitalize">Team Member</span> belongs to
                another workspace(s).
              </h2>
              <p className="mb-4">
                The team member you are trying to view belongs to one/some of
                your different workspace you are part of. Would you like to
                switch to workspace to view the team member?
              </p>
              <fetcher.Form
                action="/api/user/change-current-organization"
                method="POST"
                className="flex items-center flex-col"
              >
                <Select name="organizationId" disabled={disabled}>
                  <SelectTrigger className="mb-4 px-3.5 py-2 text-left text-gray-500 max-w-80">
                    <SelectValue placeholder="Select workspace to switch" />
                  </SelectTrigger>
                  <SelectContent
                    position="popper"
                    className="w-full min-w-80 overflow-auto p-1"
                    align="start"
                  >
                    {additionalData.organizations.map(({ organization }) => (
                      <SelectItem
                        value={organization.id}
                        key={organization.id}
                        className="px-4 py-2"
                      >
                        {organization.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input
                  type="hidden"
                  name="redirectTo"
                  value={additionalData.redirectTo}
                />
                <Button disabled={disabled}>Switch workspace</Button>
              </fetcher.Form>
            </div>
          </div>
        );
      }

      default: {
        return null;
      }
    }
  }, [additionalData]);

  return (
    <div
      className={tw("flex size-full items-center justify-center", className)}
      style={style}
    >
      {content}
    </div>
  );
}
