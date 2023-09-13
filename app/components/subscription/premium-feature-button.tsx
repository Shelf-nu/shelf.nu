import type { ButtonVariant } from "../layout/header/types";
import type { ButtonProps } from "../shared";
import { Button } from "../shared";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../shared/hover-card";

export const PremiumFeatureButton = ({
  canUseFeature,
  buttonContent = {
    title: "Use",
    message: "This feature is not available on the free tier of shelf.",
  },
  buttonProps,
}: {
  canUseFeature: boolean;
  buttonContent: {
    title: string;
    message: string;
  };
  buttonProps: ButtonProps;
}) =>
  canUseFeature ? (
    <Button {...buttonProps}>{buttonContent.title}</Button>
  ) : (
    <HoverMessage
      buttonContent={{
        ...buttonContent,
        variant: buttonProps.variant || "primary",
      }}
    />
  );

const HoverMessage = ({
  buttonContent,
}: {
  buttonContent: {
    title: string;
    message: string;
    variant?: ButtonVariant;
  };
}) => (
  <HoverCard>
    <HoverCardTrigger className="disabled inline-flex cursor-not-allowed items-center justify-center border-none p-0 text-text-sm font-semibold text-primary-700 hover:text-primary-800">
      <Button variant={buttonContent.variant || "primary"} disabled>
        {buttonContent.title}
      </Button>
    </HoverCardTrigger>
    <HoverCardContent>
      <p>
        {buttonContent.message} Please consider{" "}
        <Button to="/settings/subscription" variant={"link"}>
          upgrading to a paid plan
        </Button>
        .
      </p>
    </HoverCardContent>
  </HoverCard>
);
