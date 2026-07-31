import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Form } from "react-router";
import { CHANGE_CURRENT_ORGANIZATION_ACTION } from "~/modules/organization/constants";
import { tw } from "~/utils/tw";
import type { Error404AdditionalData } from "./utils";
import { getModelLabelForEnumValue } from "./utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms/select";
import { Button } from "../shared/button";

export type Error404HandlerProps = {
  className?: string;
  style?: CSSProperties;
  additionalData: Error404AdditionalData;
};

export default function Error404Handler({
  className,
  style,
  additionalData,
}: Error404HandlerProps) {
  /**
   * The workspace-switch forms below submit as native document submissions
   * (`reloadDocument`), for the same reason as the sidebar workspace selector:
   * the whole tenant changes, so the document is rebuilt rather than patched by
   * router revalidation. That means no fetcher state to read — we track the
   * in-flight submission locally so the button can't be double-submitted.
   *
   * @see {@link file://./../layout/sidebar/organization-selector.tsx}
   */
  const [disabled, setDisabled] = useState(false);

  const content = useMemo(() => {
    switch (additionalData.model) {
      case "asset":
      case "kit":
      case "location":
      case "booking":
      case "audit":
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
              <Form
                action={CHANGE_CURRENT_ORGANIZATION_ACTION}
                method="POST"
                reloadDocument
                onSubmit={() => setDisabled(true)}
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
                <Button type="submit" disabled={disabled}>
                  Switch workspace
                </Button>
              </Form>
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
              <Form
                action={CHANGE_CURRENT_ORGANIZATION_ACTION}
                method="POST"
                reloadDocument
                onSubmit={() => setDisabled(true)}
                className="flex flex-col items-center"
              >
                <Select name="organizationId" disabled={disabled}>
                  <SelectTrigger className="mb-4 max-w-80 px-3.5 py-2 text-left text-gray-500">
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
                <Button type="submit" disabled={disabled}>
                  Switch workspace
                </Button>
              </Form>
            </div>
          </div>
        );
      }

      default: {
        return null;
      }
    }
  }, [additionalData, disabled]);

  return (
    <div
      className={tw("flex size-full items-center justify-center", className)}
      style={style}
    >
      {content}
    </div>
  );
}
