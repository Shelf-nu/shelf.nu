import { CustomerPortalForm } from "./customer-portal-form";

export function UnpaidInvoiceBanner() {
  return (
    <div
      role="alert"
      className="bg-error-600 px-4 py-3 text-center text-sm text-white"
    >
      You have an unpaid invoice. Please{" "}
      <CustomerPortalForm
        buttonText="update your payment method"
        className="inline"
        buttonProps={{
          variant: "link",
          className: "font-semibold text-white underline",
        }}
      />{" "}
      to avoid service interruption.
    </div>
  );
}
