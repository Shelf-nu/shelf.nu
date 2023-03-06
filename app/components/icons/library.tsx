import type { SVGProps } from "react";

export function LogoutIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={20}
      height={20}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M13.333 14.167 17.5 10m0 0-4.167-4.167M17.5 10h-10m0-7.5h-1c-1.4 0-2.1 0-2.635.272a2.5 2.5 0 0 0-1.093 1.093C2.5 4.4 2.5 5.1 2.5 6.5v7c0 1.4 0 2.1.272 2.635a2.5 2.5 0 0 0 1.093 1.092C4.4 17.5 5.1 17.5 6.5 17.5h1"
        stroke="#98A2B3"
        strokeWidth={1.667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HomeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={18}
      height={18}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M5.667 13.167h6.666M8.181 1.303 2.53 5.7c-.377.294-.566.441-.702.625-.12.163-.21.347-.265.542-.062.22-.062.46-.062.938v6.03c0 .933 0 1.4.182 1.756.16.314.414.569.728.729.357.181.823.181 1.757.181h9.666c.934 0 1.4 0 1.757-.181.314-.16.569-.415.728-.729.182-.356.182-.823.182-1.757V7.804c0-.478 0-.718-.062-.938a1.665 1.665 0 0 0-.265-.542c-.136-.184-.325-.33-.702-.625L9.819 1.303c-.293-.227-.44-.341-.601-.385a.833.833 0 0 0-.436 0c-.161.044-.308.158-.6.385Z"
        stroke="#667085"
        strokeWidth={1.667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BreadcrumbChevron(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={6}
      height={10}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="m1 9 4-4-4-4"
        stroke="#D0D5DD"
        strokeWidth={1.333}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
