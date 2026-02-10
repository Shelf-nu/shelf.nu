import type { Currency } from "@prisma/client";
import { useState } from "react";
import {
  CheckCircle2Icon,
  ClipboardCheckIcon,
  SparklesIcon,
} from "lucide-react";
import { useFetcher } from "react-router";
import type { PriceWithProduct } from "~/components/subscription/prices";
import { formatCurrency } from "~/utils/currency";
import { tw } from "~/utils/tw";
import { Button } from "../shared/button";

export function UnlockAuditsPage({
  isOwner,
  usedAuditTrial,
  monthlyPrice,
  yearlyPrice,
}: {
  isOwner: boolean;
  usedAuditTrial: boolean;
  monthlyPrice: PriceWithProduct | null;
  yearlyPrice: PriceWithProduct | null;
}) {
  const [selectedInterval, setSelectedInterval] = useState<"month" | "year">(
    "year"
  );
  const subscribeFetcher = useFetcher();
  const trialFetcher = useFetcher();

  const isSubscribing = subscribeFetcher.state !== "idle";
  const isStartingTrial = trialFetcher.state !== "idle";

  const canStartTrial = isOwner && !usedAuditTrial;

  const selectedPrice =
    selectedInterval === "year" ? yearlyPrice : monthlyPrice;

  const fmtPrice = (amountInCents: number, currency: string) =>
    formatCurrency({
      value: amountInCents / 100,
      currency: currency as Currency,
      locale: "en-US",
    });

  /** Calculate yearly discount percentage compared to monthly */
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

  const features = [
    "Track and verify your assets in real-time",
    "Assign auditors and set due dates",
    "Scan QR codes for quick verification",
    "Generate detailed audit reports",
  ];

  return (
    <div className="flex size-full items-center justify-center p-6">
      <div className="w-full max-w-xl">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex items-center justify-center rounded-full border-[5px] border-solid border-primary-50 bg-primary-100 p-3 text-primary">
            <ClipboardCheckIcon className="size-6" />
          </div>
          <h2 className="mb-2 text-display-xs font-semibold">Unlock Audits</h2>
          <p className="text-gray-600">
            Add powerful audit capabilities to your workspace.
          </p>
        </div>

        {/* Feature list */}
        <div className="mb-8 rounded-xl border border-gray-200 bg-white p-6">
          <h3 className="mb-4 text-lg font-semibold">
            What you get with Audits
          </h3>
          <ul className="space-y-3">
            {features.map((feature) => (
              <li key={feature} className="flex items-start gap-3">
                <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-primary-500" />
                <span className="text-gray-700">{feature}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Pricing */}
        {(monthlyPrice || yearlyPrice) && (
          <div className="mb-8 rounded-xl border border-gray-200 bg-white p-6">
            <h3 className="mb-4 text-lg font-semibold">
              Select your pricing plan
            </h3>
            <div className="flex flex-wrap items-stretch gap-4">
              {monthlyPrice && (
                <button
                  type="button"
                  onClick={() => setSelectedInterval("month")}
                  className={tw(
                    "flex flex-1 cursor-pointer flex-col items-center rounded-lg p-4 text-center transition-colors",
                    selectedInterval === "month"
                      ? "border-2 border-primary-200 bg-primary-25"
                      : "border border-gray-200"
                  )}
                >
                  <p
                    className={tw(
                      "mb-1 text-sm font-medium",
                      selectedInterval === "month"
                        ? "text-primary-600"
                        : "text-gray-500"
                    )}
                  >
                    Monthly
                  </p>
                  <p className="text-2xl font-semibold">
                    {fmtPrice(
                      monthlyPrice.unit_amount || 0,
                      monthlyPrice.currency
                    )}
                    <span className="text-sm font-normal text-gray-500">
                      /mo
                    </span>
                  </p>
                  <p className="text-xs text-gray-500">Billed monthly</p>
                  <p className="mt-1 text-xs text-gray-500">per workspace</p>
                </button>
              )}
              {yearlyPrice && (
                <button
                  type="button"
                  onClick={() => setSelectedInterval("year")}
                  className={tw(
                    "relative flex flex-1 cursor-pointer flex-col items-center rounded-lg p-4 text-center transition-colors",
                    selectedInterval === "year"
                      ? "border-2 border-primary-200 bg-primary-25"
                      : "border border-gray-200"
                  )}
                >
                  {yearlyDiscount != null && yearlyDiscount > 0 && (
                    <span className="absolute -top-2.5 rounded-full bg-primary-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                      Save {yearlyDiscount}%
                    </span>
                  )}
                  <p
                    className={tw(
                      "mb-1 text-sm font-medium",
                      selectedInterval === "year"
                        ? "text-primary-600"
                        : "text-gray-500"
                    )}
                  >
                    Yearly
                  </p>
                  <p className="text-2xl font-semibold">
                    {fmtPrice(
                      Math.round((yearlyPrice.unit_amount || 0) / 12),
                      yearlyPrice.currency
                    )}
                    <span className="text-sm font-normal text-gray-500">
                      /mo
                    </span>
                  </p>
                  <p className="text-xs text-gray-500">
                    Billed annually{" "}
                    {fmtPrice(
                      yearlyPrice.unit_amount || 0,
                      yearlyPrice.currency
                    )}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">per workspace</p>
                </button>
              )}
            </div>
          </div>
        )}

        {/* CTAs */}
        <div className="space-y-3">
          {isOwner ? (
            <>
              {canStartTrial && yearlyPrice && (
                <trialFetcher.Form method="post" action="/audits">
                  <input type="hidden" name="intent" value="trial" />
                  <input type="hidden" name="priceId" value={yearlyPrice.id} />
                  <Button
                    type="submit"
                    variant="primary"
                    width="full"
                    disabled={isStartingTrial}
                  >
                    <span className="item flex gap-2">
                      <SparklesIcon className="size-4" />
                      {isStartingTrial
                        ? "Enabling..."
                        : "Enable for free for 7 days"}
                    </span>
                  </Button>
                </trialFetcher.Form>
              )}

              {selectedPrice && (
                <subscribeFetcher.Form method="post" action="/audits">
                  <input type="hidden" name="intent" value="subscribe" />
                  <input
                    type="hidden"
                    name="priceId"
                    value={selectedPrice.id}
                  />
                  <Button
                    type="submit"
                    variant={canStartTrial ? "secondary" : "primary"}
                    width="full"
                    disabled={isSubscribing}
                  >
                    {isSubscribing
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
                </subscribeFetcher.Form>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-center">
              <p className="text-gray-600">
                Contact your workspace owner to enable the Audits add-on for
                your organization.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
