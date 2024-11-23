import { tw } from "~/utils/tw";
import { Error404AdditionalData } from "./utils";
import { Button } from "../shared/button";
import { useFetcher } from "@remix-run/react";
import { isFormProcessing } from "~/utils/form";

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

  return (
    <div
      className={tw("flex size-full items-center justify-center", className)}
      style={style}
    >
      <div className="flex flex-col items-center text-center">
        <div className="w-full md:max-w-screen-sm">
          <h2 className="mb-2">
            <span className="capitalize">{additionalData.model}</span> belongs
            to another workspace.
          </h2>
          <p className="mb-4">
            The {additionalData.model} you are trying to view belongs to a
            different workspace you are part of. Would you like to switch to
            workspace{" "}
            <span className="font-bold">
              "{additionalData.organization.organization.name}"
            </span>{" "}
            to view the {additionalData.model}?
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
    </div>
  );
}
