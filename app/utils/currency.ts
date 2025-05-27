import type { Currency } from "@prisma/client";

export function formatCurrency({
  value,
  currency,
  locale,
}: {
  value: number;
  currency: Currency;
  locale: string;
}) {
  return value.toLocaleString(locale, {
    currency,
    style: "currency",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
