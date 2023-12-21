import { tw } from "~/utils";
import type { ButtonVariant } from "../layout/header/types";
import type { ButtonProps } from "../shared";
import { Button } from "../shared";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../shared/hover-card";

export const ControlledActionButton = ({
  canUseFeature,
  buttonContent = {
    title: "Use",
    message: "This feature is not available on the free tier of shelf.",
    ctaText: "Upgrade to a paid plan",
  },
  buttonProps,
  skipCta = false,
}: {
  canUseFeature: boolean;
  buttonContent: {
    title: string | JSX.Element | JSX.Element[];
    message: string;
    ctaText?: string;
  };
  buttonProps: ButtonProps;
  skipCta?: boolean;
}) =>
  canUseFeature ? (
    <Button {...buttonProps}>{buttonContent.title}</Button>
  ) : (
    <HoverMessage
      buttonContent={{
        ...buttonContent,
        variant: buttonProps.variant || "primary",
        ctaText: buttonContent?.ctaText || "Upgrade to a paid plan",
      }}
      skipCta={skipCta}
      buttonProps={buttonProps}
    />
  );

const HoverMessage = ({
  buttonContent,
  skipCta,
  buttonProps,
}: {
  buttonContent: {
    title: string | JSX.Element | JSX.Element[];
    message: string;
    variant?: ButtonVariant;
    ctaText: string;
  };
  skipCta: boolean;
  buttonProps: ButtonProps;
}) => (
  <HoverCard>
    <HoverCardTrigger
      className={tw(
        "disabled inline-flex cursor-not-allowed items-center justify-center border-none p-0 text-left text-text-sm font-semibold text-primary-700 hover:text-primary-800",
        buttonProps?.width === "full" ? "w-full" : ""
      )}
    >
      <Button {...buttonProps} disabled>
        {buttonContent.title}
      </Button>
    </HoverCardTrigger>
    <HoverCardContent>
      <p className="text-left">
        {buttonContent.message}
        {!skipCta ? (
          <span>
            Please consider{" "}
            <Button to="/settings/subscription" variant={"link"}>
              {buttonContent.ctaText}
            </Button>
          </span>
        ) : null}
        .
      </p>
    </HoverCardContent>
  </HoverCard>
);
