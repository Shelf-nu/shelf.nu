import { tw } from "~/utils/tw";
import type { Price } from "./prices";
import {
  DoubleLayerIcon,
  HelpIcon,
  MultiLayerIcon,
  SingleLayerIcon,
} from "../icons/library";
import { CrispButton } from "../marketing/crisp";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shared/tooltip";
import { JSX } from "react";

export const PriceBox = ({ price }: { price: Price }) => {
  const amount =
    price.unit_amount != null
      ? price?.recurring?.interval === "year"
        ? price.unit_amount / 10
        : price.unit_amount
      : null;

  const { shelf_tier } = price.product.metadata;

  return (
    <div
      className={tw("price-box mb-8 rounded-2xl border bg-white p-8")}
      key={price.id}
    >
      <div className="text-center">
        <div className="mb-3 inline-flex items-center justify-center rounded-full border-[5px] border-solid border-primary-50 bg-primary-100 p-1.5 text-primary">
          <i className=" inline-flex min-h-[20px] min-w-[20px] items-center justify-center">
            {shelf_tier ? plansIconsMap[shelf_tier] : plansIconsMap["free"]}
          </i>
        </div>
        <div className="mb-3 flex items-center justify-center gap-2">
          <h2 className=" text-xl font-semibold text-primary-700">
            {price.product.name}
          </h2>
        </div>
        {amount != null ? (
          <div className="mb-3 ">
            <div className=" text-4xl font-semibold text-gray-900">
              {(amount / 100).toLocaleString("en-US", {
                style: "currency",
                currency: price.currency,
                maximumFractionDigits: 0,
              })}
              {price.recurring ? <span>/mo</span> : null}
            </div>
            <div className="text-xs text-gray-500">
              {price?.recurring?.interval === "year" && (
                <>
                  <span>
                    Billed annually{" "}
                    {(amount / 10).toLocaleString("en-US", {
                      style: "currency",
                      currency: price.currency,
                      maximumFractionDigits: 0,
                    })}
                  </span>
                </>
              )}

              {price?.recurring?.interval === "month" && `Billed montly`}

              {shelf_tier === "tier_2" && (
                <div className="flex items-center justify-center gap-1">
                  <div className="text-xs font-normal text-gray-500">
                    per workspace
                  </div>{" "}
                  <PerWorkspaceTooltip />
                </div>
              )}
            </div>
          </div>
        ) : null}
        <p className="price-slogan min-h-[48px] text-base text-gray-600">
          {price.product.metadata.slogan}
        </p>
      </div>
    </div>
  );
};

export const plansIconsMap: { [key: string]: JSX.Element } = {
  free: <SingleLayerIcon />,
  tier_1: <DoubleLayerIcon />,
  tier_2: <MultiLayerIcon />,
};

export const PerWorkspaceTooltip = () => (
  <TooltipProvider delayDuration={100}>
    <Tooltip>
      <TooltipTrigger asChild>
        <i className="cursor-pointer text-gray-400 hover:text-gray-700">
          <HelpIcon />
        </i>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="text-xs font-medium text-gray-500">
          To enable multiple workspaces for your account, <br />
          please{" "}
          <CrispButton variant="link" className="!w-auto text-xs">
            contact sales
          </CrispButton>
          .
        </p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);
