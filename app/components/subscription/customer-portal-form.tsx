import { useFetcher } from "@remix-run/react";
import { isFormProcessing } from "~/utils/form";
import { Button } from "../shared/button";

export const CustomerPortalForm = ({
  buttonText = "Go to Customer Portal",
}: {
  buttonText?: string;
}) => {
  const customerPortalFetcher = useFetcher();
  const isProcessing = isFormProcessing(customerPortalFetcher.state);
  return (
    <customerPortalFetcher.Form
      method="post"
      action="/account-details/subscription/customer-portal"
    >
      <Button disabled={isProcessing}>
        {isProcessing ? "Redirecting to Customer Portal..." : buttonText}
      </Button>
    </customerPortalFetcher.Form>
  );
};
