import { tw } from "~/utils/tw";
import type { ButtonProps } from "./button";
import { Button } from "./button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card";
import type { ButtonVariant } from "../layout/header/types";

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
    message?: string;
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
    message?: string;
    variant?: ButtonVariant;
    ctaText: string;
  };
  skipCta: boolean;
  buttonProps: ButtonProps;
}) => {
  /**
   * Because of how our button component works, we have to make sure to delete .to from the props
   * In this case it doesnt do anything as its just the hover card trigger, and we basically need only the styles and other props from buttonProps.
   * So we remove the .to to make sure the Button is not rendered as a Link and we dont get hydration issues
   * Moreover we set the .as prop to "button" to make sure it renders as a button
   */
  delete buttonProps.to;
  buttonProps.as = "button";

  return (
    <HoverCard openDelay={100}>
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
      {buttonContent.message && (
        <HoverCardContent>
          <p className="text-left">
            {buttonContent.message}
            {!skipCta ? (
              <span>
                {" "}
                Please switch to your team workspace to use this feature
              </span>
            ) : null}
            .
          </p>
        </HoverCardContent>
      )}
    </HoverCard>
  );
};
