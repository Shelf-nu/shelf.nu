import { useFetcher } from "react-router";
import { isFormProcessing } from "~/utils/form";
import { Button } from "../shared/button";

export const CustomerPortalForm = ({
  buttonText = "Go to Customer Portal",
  buttonProps,
  className,
}: {
  buttonText?: string;
  buttonProps?: React.ComponentProps<typeof Button>;
  className?: string;
}) => {
  const customerPortalFetcher = useFetcher();
  const isProcessing = isFormProcessing(customerPortalFetcher.state);
  return (
    <customerPortalFetcher.Form
      method="post"
      action="/account-details/subscription/customer-portal"
      className={className}
    >
      <Button disabled={isProcessing} {...buttonProps}>
        {isProcessing ? "Redirecting to Customer Portal..." : buttonText}
      </Button>
    </customerPortalFetcher.Form>
  );
};
