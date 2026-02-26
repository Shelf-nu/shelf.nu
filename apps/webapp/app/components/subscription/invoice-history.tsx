import { Button } from "../shared/button";
import { DateS } from "../shared/date";

export type PaidInvoice = {
  id: string;
  number: string | null;
  amountPaid: number;
  currency: string;
  paidAt: number | null;
  hostedInvoiceUrl: string | null;
};

export type UpcomingInvoice = {
  subscriptionId: string;
  subscriptionName: string;
  amountDue: number;
  currency: string;
  periodEnd: number;
};

type InvoiceHistoryProps = {
  paidInvoices: PaidInvoice[];
  upcomingInvoices: UpcomingInvoice[];
};

export function InvoiceHistory({
  paidInvoices,
  upcomingInvoices,
}: InvoiceHistoryProps) {
  const hasUpcoming = upcomingInvoices.length > 0;
  const hasPaid = paidInvoices.length > 0;

  if (!hasUpcoming && !hasPaid) {
    return null;
  }

  return (
    <div className="mt-8">
      <h3 className="mb-4 text-text-lg font-semibold">Billing History</h3>

      {hasUpcoming && (
        <div className="mb-6 rounded border border-gray-300">
          <div className="border-b border-gray-300 bg-gray-50 px-4 py-3">
            <div className="text-sm font-medium uppercase text-gray-500">
              Upcoming {upcomingInvoices.length > 1 ? "Invoices" : "Invoice"}
            </div>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 text-left text-sm text-gray-500">
                <th className="px-4 py-3 font-medium">Subscription</th>
                <th className="px-4 py-3 font-medium">Billing Date</th>
                <th className="px-4 py-3 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {upcomingInvoices.map((invoice) => (
                <tr
                  key={invoice.subscriptionId}
                  className="border-b border-gray-200 last:border-b-0"
                >
                  <td className="px-4 py-3 text-sm font-medium">
                    {invoice.subscriptionName}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    <DateS date={new Date(invoice.periodEnd * 1000)} />
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {formatCurrency(invoice.amountDue, invoice.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasPaid && (
        <div className="rounded border border-gray-300">
          <div className="border-b border-gray-300 bg-gray-50 px-4 py-3">
            <div className="text-sm font-medium uppercase text-gray-500">
              Past Invoices
            </div>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 text-left text-sm text-gray-500">
                <th className="px-4 py-3 font-medium">Invoice</th>
                <th className="px-4 py-3 font-medium">Date Paid</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {paidInvoices.map((invoice) => (
                <tr
                  key={invoice.id}
                  className="border-b border-gray-200 last:border-b-0"
                >
                  <td className="px-4 py-3 text-sm font-medium">
                    {invoice.number || "-"}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {invoice.paidAt ? (
                      <DateS date={new Date(invoice.paidAt * 1000)} />
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {formatCurrency(invoice.amountPaid, invoice.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-success-50 px-2 py-1 text-xs font-medium text-success-700">
                      Paid
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {invoice.hostedInvoiceUrl && (
                      <Button
                        href={invoice.hostedInvoiceUrl}
                        as="a"
                        target="_blank"
                        rel="noopener noreferrer"
                        variant="link-gray"
                      >
                        View invoice
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency,
  }).format(amount / 100);
}
