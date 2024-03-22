import type { SVGProps } from "react";
import { AssetStatus } from "@prisma/client";
import { Badge } from "../shared/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shared/tooltip";

export const userFriendlyAssetStatus = (status: AssetStatus) => {
  switch (status) {
    case AssetStatus.IN_CUSTODY:
      return "In custody";
    case AssetStatus.CHECKED_OUT:
      return "Checked out";
    default:
      return "Available";
  }
};

export const assetStatusColorMap = (status: AssetStatus) => {
  switch (status) {
    case AssetStatus.IN_CUSTODY:
      return "#2E90FA";
    case AssetStatus.CHECKED_OUT:
      return "#5925DC";
    default:
      return "#12B76A";
  }
};

export function AssetStatusBadge({
  status,
  availableToBook = true,
}: {
  status: AssetStatus;
  availableToBook: boolean;
}) {
  // If the asset is not available to book, it is unavailable
  // We handle this on front-end as syncing status with the flag is very complex on backend and error prone so this is the lesser evil
  return (
    <div className="flex items-center gap-[6px]">
      <Badge color={assetStatusColorMap(status)}>
        {userFriendlyAssetStatus(status)}
      </Badge>
      {!availableToBook && <UnavailableBadge />}
    </div>
  );
}

const UnavailableBadge = (props: SVGProps<SVGSVGElement>) => (
  <TooltipProvider delayDuration={100}>
    <Tooltip>
      <TooltipTrigger asChild>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width={22}
          height={22}
          fill="none"
          {...props}
        >
          <g
            style={{
              mixBlendMode: "multiply",
            }}
          >
            <rect width={22} height={22} fill="#F2F4F7" rx={11} />
            <rect width={22} height={22} stroke="#EAECF0" rx={11} />
            <g clipPath="url(#a)">
              <path
                stroke="#667085"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15.5 10.75V9.4c0-.84 0-1.26-.164-1.581a1.5 1.5 0 0 0-.655-.656C14.361 7 13.941 7 13.1 7H8.9c-.84 0-1.26 0-1.581.163a1.5 1.5 0 0 0-.656.656c-.163.32-.163.74-.163 1.581v4.2c0 .84 0 1.26.163 1.581a1.5 1.5 0 0 0 .656.655c.32.164.74.164 1.581.164h2.35m4.25-6h-9M13 6v2M9 6v2m6.5 7.5L13 13m.1 2.5 2.4-2.5"
              />
            </g>
          </g>
          <defs>
            <clipPath id="a">
              <path fill="#fff" d="M5 5h12v12H5z" />
            </clipPath>
          </defs>
        </svg>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>This asset is marked as unavailable for bookings</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);
