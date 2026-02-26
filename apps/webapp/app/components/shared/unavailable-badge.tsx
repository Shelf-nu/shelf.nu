import type { SVGProps } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";

type UnavailableBadgeProps = SVGProps<SVGSVGElement> & {
  title: string;
};

export function UnavailableBadge({
  title,
  ...svgProps
}: UnavailableBadgeProps) {
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width={22}
            height={22}
            fill="none"
            {...svgProps}
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
          <p>{title}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
