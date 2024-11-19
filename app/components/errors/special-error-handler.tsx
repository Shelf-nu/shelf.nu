import { tw } from "~/utils/tw";
import { SpecialErrorAdditionalData } from "./utils";
import { useMemo } from "react";
import { ErrorIcon } from ".";
import { Button } from "../shared/button";

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
  const content = useMemo(() => {
    switch (additionalData.type) {
      case "asset-from-other-org": {
        return (
          <div className="w-full md:max-w-screen-sm">
            <h2 className="mb-2">Asset belongs to other workspace.</h2>
            <p className="mb-4">
              The asset you are trying to view belongs to a different workspace
              you are part of. Would you like to switch to workspace{" "}
              <span className="font-bold">
                "{additionalData.assetOrganization.organization.name}"
              </span>{" "}
              to view the asset?
            </p>

            <Button>Switch workspace</Button>
          </div>
        );
      }

      default: {
        return null;
      }
    }
  }, []);

  return (
    <div
      className={tw("flex size-full items-center justify-center", className)}
      style={style}
    >
      <div className="flex flex-col items-center text-center">
        <span className="mb-5 size-[56px] text-primary">
          <ErrorIcon />
        </span>
        {content}
      </div>
    </div>
  );
}
