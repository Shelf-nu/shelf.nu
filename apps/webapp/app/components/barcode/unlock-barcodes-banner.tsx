import { useEffect, useState } from "react";
import type { Currency } from "@prisma/client";
import { BarcodeIcon, CheckCircle2Icon, SparklesIcon } from "lucide-react";
import { useFetcher } from "react-router";
import type { PriceWithProduct } from "~/components/subscription/prices";
import { BARCODE_ADDON } from "~/config/addon-copy";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useDisabled } from "~/hooks/use-disabled";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { loader as pricesLoader } from "~/routes/api+/barcode-addon-prices";
import { formatCurrency } from "~/utils/currency";
import { tw } from "~/utils/tw";
import { Button } from "../shared/button";
import type { CommonButtonProps } from "../shared/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../shared/modal";

const fmtPrice = (amountInCents: number, currency: string) =>
  formatCurrency({
    value: amountInCents / 100,
    currency: currency as Currency,
    locale: "en-US",
  });

const FEATURES = BARCODE_ADDON.features;

/** Shared hook that loads barcode addon prices and org trial state */
function useBarcodeAddonState() {
  const currentOrganization = useCurrentOrganization();
  const priceFetcher = useFetcher<typeof pricesLoader>();
  const actionFetcher = useFetcher();
  const disabled = useDisabled(actionFetcher);

  const usedBarcodeTrial = currentOrganization?.usedBarcodeTrial ?? false;

  // Load prices on mount
  useEffect(() => {
    if (priceFetcher.state === "idle" && !priceFetcher.data) {
      void priceFetcher.load("/api/barcode-addon-prices");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prices = priceFetcher.data;
  const monthlyPrice = prices && "month" in prices ? prices.month : null;
  const yearlyPrice = prices && "year" in prices ? prices.year : null;
  const hasPrice = !!(monthlyPrice || yearlyPrice);
  const hasPaymentMethod =
    prices && "hasPaymentMethod" in prices
      ? (prices.hasPaymentMethod as boolean)
      : false;

  return {
    usedBarcodeTrial,
    monthlyPrice,
    yearlyPrice,
    hasPrice,
    hasPaymentMethod,
    actionFetcher,
    disabled,
  };
}

/** Modal content for unlocking barcodes — used by both the banner and standalone trigger */
function UnlockBarcodesModalContent({
  monthlyPrice,
  yearlyPrice,
  hasPrice,
  hasPaymentMethod,
  usedBarcodeTrial,
  actionFetcher,
  disabled,
}: {
  monthlyPrice: PriceWithProduct | null;
  yearlyPrice: PriceWithProduct | null;
  hasPrice: boolean;
  hasPaymentMethod: boolean;
  usedBarcodeTrial: boolean;
  actionFetcher: ReturnType<typeof useFetcher>;
  disabled: boolean;
}) {
  return (
    <AlertDialogContent className="max-w-lg">
      <AlertDialogHeader>
        <div className="mb-2 inline-flex size-10 items-center justify-center rounded-full border-[5px] border-solid border-primary-50 bg-primary-100 text-primary">
          <BarcodeIcon className="size-5" />
        </div>
        <AlertDialogTitle>Unlock {BARCODE_ADDON.label}</AlertDialogTitle>
        <AlertDialogDescription>
          {BARCODE_ADDON.subtitle}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <ul className="space-y-2.5">
        {FEATURES.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5">
            <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-primary-500" />
            <span className="text-sm text-gray-700">{feature}</span>
          </li>
        ))}
      </ul>

      {hasPrice ? (
        <BarcodeModalPricing
          monthlyPrice={monthlyPrice}
          yearlyPrice={yearlyPrice}
          usedBarcodeTrial={usedBarcodeTrial}
          hasPaymentMethod={hasPaymentMethod}
          actionFetcher={actionFetcher}
          disabled={disabled}
        />
      ) : null}

      <AlertDialogCancel asChild>
        <Button type="button" variant="secondary" width="full">
          Close
        </Button>
      </AlertDialogCancel>
    </AlertDialogContent>
  );
}

/**
 * Standalone modal trigger for unlocking barcodes.
 * Used by the code-preview + button and the censored barcode state.
 */
export function UnlockBarcodesModal({
  triggerClassName,
  triggerVariant = "secondary",
  triggerSize,
  triggerIcon,
  triggerLabel = "Learn more",
}: {
  triggerClassName?: string;
  triggerVariant?: CommonButtonProps["variant"];
  triggerSize?: CommonButtonProps["size"];
  triggerIcon?: CommonButtonProps["icon"];
  triggerLabel?: string;
}) {
  const state = useBarcodeAddonState();

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant={triggerVariant}
          size={triggerSize}
          icon={triggerIcon}
          className={triggerClassName}
        >
          {triggerLabel}
        </Button>
      </AlertDialogTrigger>
      <UnlockBarcodesModalContent {...state} />
    </AlertDialog>
  );
}

/** Inline banner with "Learn more" that opens the unlock modal */
export function UnlockBarcodesBanner() {
  const { isOwner } = useUserRoleHelper();

  if (!isOwner) {
    return (
      <div className="rounded border border-gray-200 bg-gray-50 p-4">
        <h4 className="text-sm font-semibold text-gray-900">
          {BARCODE_ADDON.label}
        </h4>
        <p className="mt-1 text-sm text-gray-600">
          {BARCODE_ADDON.nonOwnerDescription}
        </p>
      </div>
    );
  }

  return <OwnerBarcodesBanner />;
}

/** Owner-only banner that loads prices and shows the unlock modal */
function OwnerBarcodesBanner() {
  const state = useBarcodeAddonState();

  return (
    <div className="rounded border border-gray-200 bg-gray-50 p-4">
      <h4 className="text-sm font-semibold text-gray-900">
        {BARCODE_ADDON.label}
      </h4>
      <p className="mt-1 text-sm text-gray-600">{BARCODE_ADDON.description}</p>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="secondary" className="mt-3">
            Learn more
          </Button>
        </AlertDialogTrigger>
        <UnlockBarcodesModalContent {...state} />
      </AlertDialog>
    </div>
  );
}

function BarcodeModalPricing({
  monthlyPrice,
  yearlyPrice,
  usedBarcodeTrial,
  hasPaymentMethod,
  actionFetcher,
  disabled,
}: {
  monthlyPrice: PriceWithProduct | null;
  yearlyPrice: PriceWithProduct | null;
  usedBarcodeTrial: boolean;
  hasPaymentMethod: boolean;
  actionFetcher: ReturnType<typeof useFetcher>;
  disabled: boolean;
}) {
  const [selectedInterval, setSelectedInterval] = useState<"month" | "year">(
    "year"
  );
  const [consentChecked, setConsentChecked] = useState(false);

  const canTrial = !usedBarcodeTrial;
  const selectedPrice =
    selectedInterval === "year" ? yearlyPrice : monthlyPrice;

  const yearlyDiscount =
    monthlyPrice && yearlyPrice
      ? Math.round(
          (1 -
            (yearlyPrice.unit_amount || 0) /
              12 /
              (monthlyPrice.unit_amount || 1)) *
            100
        )
      : null;

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        {monthlyPrice && (
          <button
            type="button"
            onClick={() => setSelectedInterval("month")}
            className={tw(
              "relative flex flex-1 flex-col items-center rounded-lg p-3 text-center transition-colors",
              selectedInterval === "month"
                ? "border-2 border-primary-200 bg-primary-25"
                : "border border-gray-200"
            )}
          >
            <p
              className={tw(
                "mb-0.5 text-xs font-medium",
                selectedInterval === "month"
                  ? "text-primary-600"
                  : "text-gray-500"
              )}
            >
              Monthly
            </p>
            <p className="text-lg font-semibold">
              {fmtPrice(monthlyPrice.unit_amount || 0, monthlyPrice.currency)}
              <span className="text-xs font-normal text-gray-500">/mo</span>
            </p>
          </button>
        )}
        {yearlyPrice && (
          <button
            type="button"
            onClick={() => setSelectedInterval("year")}
            className={tw(
              "relative flex flex-1 flex-col items-center rounded-lg p-3 text-center transition-colors",
              selectedInterval === "year"
                ? "border-2 border-primary-200 bg-primary-25"
                : "border border-gray-200"
            )}
          >
            {yearlyDiscount != null && yearlyDiscount > 0 && (
              <span className="absolute -top-2 rounded-full bg-primary-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                Save {yearlyDiscount}%
              </span>
            )}
            <p
              className={tw(
                "mb-0.5 text-xs font-medium",
                selectedInterval === "year"
                  ? "text-primary-600"
                  : "text-gray-500"
              )}
            >
              Yearly
            </p>
            <p className="text-lg font-semibold">
              {fmtPrice(
                Math.round((yearlyPrice.unit_amount || 0) / 12),
                yearlyPrice.currency
              )}
              <span className="text-xs font-normal text-gray-500">/mo</span>
            </p>
          </button>
        )}
      </div>

      {canTrial && hasPaymentMethod && (
        <div className="rounded-lg border border-[#FFE082] bg-[#FFF8E1] p-3">
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
              className="mt-0.5 shrink-0"
            />
            <span className="text-[13px] text-gray-600">
              I understand that after the 7-day free trial, my payment method on
              file will be automatically charged at the regular subscription
              rate. I can cancel anytime before the trial ends to avoid being
              charged.
            </span>
          </label>
        </div>
      )}

      {canTrial && yearlyPrice && (
        <actionFetcher.Form method="post" action="/api/barcode-addon">
          <input type="hidden" name="priceId" value={yearlyPrice.id} />
          {consentChecked && (
            <input type="hidden" name="consentAcknowledged" value="true" />
          )}
          <Button
            type="submit"
            name="intent"
            value="trial"
            variant="primary"
            width="full"
            disabled={disabled || (hasPaymentMethod && !consentChecked)}
          >
            <span className="flex items-center gap-2">
              <SparklesIcon className="size-4" />
              {disabled ? "Enabling..." : "Enable for free for 7 days"}
            </span>
          </Button>
        </actionFetcher.Form>
      )}

      {selectedPrice && (
        <actionFetcher.Form method="post" action="/api/barcode-addon">
          <input type="hidden" name="priceId" value={selectedPrice.id} />
          <Button
            type="submit"
            name="intent"
            value="subscribe"
            variant={canTrial ? "secondary" : "primary"}
            width="full"
            disabled={disabled}
          >
            {disabled
              ? "Redirecting..."
              : selectedInterval === "year"
              ? `Subscribe yearly (${fmtPrice(
                  selectedPrice.unit_amount || 0,
                  selectedPrice.currency
                )}/yr)`
              : `Subscribe monthly (${fmtPrice(
                  selectedPrice.unit_amount || 0,
                  selectedPrice.currency
                )}/mo)`}
          </Button>
        </actionFetcher.Form>
      )}
    </div>
  );
}
