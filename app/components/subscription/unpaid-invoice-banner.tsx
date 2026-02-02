import { Link } from "react-router";

export function UnpaidInvoiceBanner() {
  return (
    <div className="bg-error-600 px-4 py-3 text-center text-sm text-white -mx-4">
      You have an unpaid invoice. Please{" "}
      <Link
        to="/account-details/subscription"
        className="font-semibold underline"
      >
        update your payment method
      </Link>{" "}
      to avoid service interruption.
    </div>
  );
}
