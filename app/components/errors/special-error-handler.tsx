import { tw } from "~/utils/tw";
import { SpecialErrorAdditionalData } from "./utils";
import { ErrorIcon } from ".";
import { Button } from "../shared/button";
import { useFetcher } from "@remix-run/react";
import { isFormProcessing } from "~/utils/form";

export type SpecialErrorHandlerProps = {
  className?: string;
  style?: React.CSSProperties;
  additionalData: SpecialErrorAdditionalData;
};

export default function SpecialErrorHandler({
  className,
  style,
  additionalData,
}: SpecialErrorHandlerProps) {
  const fetcher = useFetcher();
  const disabled = isFormProcessing(fetcher.state);

  return (
    <div
      className={tw("flex size-full items-center justify-center", className)}
      style={style}
    >
      <div className="flex flex-col items-center text-center">
        <span className="mb-5 size-[56px] text-primary">
          <ErrorIcon />
        </span>
        <div className="w-full md:max-w-screen-sm">
          <h2 className="mb-2">
            <span className="capitalize">{additionalData.model}</span> belongs
            to other workspace.
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
              value={`/${additionalData.model}/${additionalData.id}/overview`}
            />
            <Button disabled={disabled}>Switch workspace</Button>
          </fetcher.Form>
        </div>
      </div>
    </div>
  );
}
