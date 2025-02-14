import type { SVGProps } from "react";
import { CalendarPlus } from "lucide-react";

export function LogoutIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 16 16"
      width={16}
      height={16}
      {...props}
    >
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M10.667 11.333 14 8m0 0-3.333-3.333M14 8H6m0-6h-.8c-1.12 0-1.68 0-2.108.218a2 2 0 0 0-.874.874C2 3.52 2 4.08 2 5.2v5.6c0 1.12 0 1.68.218 2.108a2 2 0 0 0 .874.874C3.52 14 4.08 14 5.2 14H6"
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

export function ChevronRight(props: SVGProps<SVGSVGElement>) {
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
        stroke="currentColor"
        strokeWidth={1.333}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ItemsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={20}
      height={20}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M6 13v2m4-6v6m4-10v10m-8.2 4h8.4c1.68 0 2.52 0 3.162-.327a3 3 0 0 0 1.311-1.311C19 16.72 19 15.88 19 14.2V5.8c0-1.68 0-2.52-.327-3.162a3 3 0 0 0-1.311-1.311C16.72 1 15.88 1 14.2 1H5.8c-1.68 0-2.52 0-3.162.327a3 3 0 0 0-1.311 1.311C1 3.28 1 4.12 1 5.8v8.4c0 1.68 0 2.52.327 3.162a3 3 0 0 0 1.311 1.311C3.28 19 4.12 19 5.8 19Z"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SettingsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 22 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M11 14a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17.727 13.727a1.5 1.5 0 0 0 .3 1.655l.055.054a1.816 1.816 0 0 1 0 2.573 1.818 1.818 0 0 1-2.573 0l-.055-.055a1.5 1.5 0 0 0-1.654-.3 1.5 1.5 0 0 0-.91 1.373v.155a1.818 1.818 0 1 1-3.635 0V19.1a1.5 1.5 0 0 0-.982-1.373 1.5 1.5 0 0 0-1.655.3l-.054.055a1.818 1.818 0 0 1-3.106-1.287 1.818 1.818 0 0 1 .533-1.286l.054-.055a1.5 1.5 0 0 0 .3-1.654 1.5 1.5 0 0 0-1.372-.91h-.155a1.818 1.818 0 1 1 0-3.635H2.9a1.5 1.5 0 0 0 1.373-.982 1.5 1.5 0 0 0-.3-1.655l-.055-.054A1.818 1.818 0 1 1 6.491 3.99l.054.054a1.5 1.5 0 0 0 1.655.3h.073a1.5 1.5 0 0 0 .909-1.372v-.155a1.818 1.818 0 0 1 3.636 0V2.9a1.499 1.499 0 0 0 .91 1.373 1.5 1.5 0 0 0 1.654-.3l.054-.055a1.817 1.817 0 0 1 2.573 0 1.819 1.819 0 0 1 0 2.573l-.055.054a1.5 1.5 0 0 0-.3 1.655v.073a1.5 1.5 0 0 0 1.373.909h.155a1.818 1.818 0 0 1 0 3.636H19.1a1.499 1.499 0 0 0-1.373.91Z"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={"100%"}
      height={"100%"}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M10 4.167v11.666M4.167 10h11.666"
        stroke="currentColor"
        strokeWidth={1.667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TrashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={20}
      height={20}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M13.333 5v-.667c0-.933 0-1.4-.181-1.756a1.667 1.667 0 0 0-.729-.729c-.356-.181-.823-.181-1.756-.181H9.333c-.933 0-1.4 0-1.756.181-.314.16-.569.415-.729.729-.181.356-.181.823-.181 1.756V5m1.666 4.583v4.167m3.334-4.167v4.167M2.5 5h15m-1.667 0v9.333c0 1.4 0 2.1-.272 2.635a2.5 2.5 0 0 1-1.093 1.093c-.534.272-1.235.272-2.635.272H8.167c-1.4 0-2.1 0-2.635-.272a2.5 2.5 0 0 1-1.093-1.093c-.272-.535-.272-1.235-.272-2.635V5"
        stroke="currentColor"
        strokeWidth={1.667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ArchiveIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={20}
      height={20}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M3.333 6.664a1.912 1.912 0 0 1-.325-.03 1.667 1.667 0 0 1-1.31-1.309c-.032-.16-.032-.354-.032-.742 0-.387 0-.58.032-.741a1.667 1.667 0 0 1 1.31-1.31c.16-.032.354-.032.741-.032h12.5c.388 0 .581 0 .742.032a1.667 1.667 0 0 1 1.31 1.31c.032.16.032.354.032.741 0 .388 0 .581-.032.742a1.667 1.667 0 0 1-1.31 1.31c-.09.017-.188.025-.325.029m-8.333 4.17h3.333M3.333 6.666h13.333V13.5c0 1.4 0 2.1-.273 2.635a2.5 2.5 0 0 1-1.092 1.092c-.535.273-1.235.273-2.635.273H7.333c-1.4 0-2.1 0-2.635-.273a2.5 2.5 0 0 1-1.093-1.092c-.272-.535-.272-1.235-.272-2.635V6.667Z"
        stroke="currentColor"
        strokeWidth={1.667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MailIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={20}
      height={16}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M1.667 3.833 8.47 8.596c.55.386.826.579 1.126.653.265.066.541.066.806 0 .3-.074.575-.267 1.126-.653l6.804-4.763M5.667 14.667h8.666c1.4 0 2.1 0 2.635-.273a2.5 2.5 0 0 0 1.093-1.092c.272-.535.272-1.235.272-2.635V5.333c0-1.4 0-2.1-.272-2.635a2.5 2.5 0 0 0-1.093-1.092c-.535-.273-1.235-.273-2.635-.273H5.667c-1.4 0-2.1 0-2.635.273a2.5 2.5 0 0 0-1.093 1.092c-.272.535-.272 1.235-.272 2.635v5.334c0 1.4 0 2.1.272 2.635a2.5 2.5 0 0 0 1.093 1.092c.534.273 1.235.273 2.635.273Z"
        stroke="#667085"
        strokeWidth={1.667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function FileUploadIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={46}
      height={46}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <rect x={3} y={3} width={40} height={40} rx={20} fill="#F2F4F7" />
      <path
        d="M19.667 26.333 23 23m0 0 3.333 3.333M23 23v7.5m6.667-3.548a4.583 4.583 0 0 0-2.917-8.12.516.516 0 0 1-.445-.25 6.25 6.25 0 1 0-9.816 7.58"
        stroke="#475467"
        strokeWidth={1.667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x={3}
        y={3}
        width={40}
        height={40}
        rx={20}
        stroke="#F9FAFB"
        strokeWidth={6}
      />
    </svg>
  );
}

export function ImageFileIcon({
  error = undefined,
  ...rest
}: {
  rest?: SVGProps<SVGSVGElement>;
  error?: boolean | undefined;
}) {
  return (
    <svg
      width={36}
      height={36}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      <rect
        x={2}
        y={2}
        width={32}
        height={32}
        rx={16}
        fill={error ? "#FEE4E2" : "#FDEAD7"}
      />
      <path
        d="M20.8 24h-6.18c-.403 0-.605 0-.698-.08a.333.333 0 0 1-.116-.28c.01-.122.152-.265.438-.55l5.668-5.67c.264-.263.396-.395.549-.445a.667.667 0 0 1 .412 0c.152.05.284.182.548.446L24 20v.8M20.8 24c1.12 0 1.68 0 2.108-.218a2 2 0 0 0 .874-.874C24 22.48 24 21.92 24 20.8M20.8 24h-5.6c-1.12 0-1.68 0-2.108-.218a2 2 0 0 1-.874-.874C12 22.48 12 21.92 12 20.8v-5.6c0-1.12 0-1.68.218-2.108a2 2 0 0 1 .874-.874C13.52 12 14.08 12 15.2 12h5.6c1.12 0 1.68 0 2.108.218a2 2 0 0 1 .874.874C24 13.52 24 14.08 24 15.2v5.6m-7-5.133a1.333 1.333 0 1 1-2.667 0 1.333 1.333 0 0 1 2.667 0Z"
        stroke={error ? "#D92D20" : "currentColor"}
        strokeWidth={1.333}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x={2}
        y={2}
        width={32}
        height={32}
        rx={16}
        stroke={error ? "#FEF3F2" : "#FEF6EE"}
        strokeWidth={4}
      />
    </svg>
  );
}

export function CheckmarkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={16}
      height={16}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <rect
        x={0.5}
        y={0.5}
        width={15}
        height={15}
        rx={7.5}
        fill="currentColor"
      />
      <path
        d="M11.333 5.5 6.75 10.083 4.667 8"
        stroke="#fff"
        strokeWidth={1.667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x={0.5}
        y={0.5}
        width={15}
        height={15}
        rx={7.5}
        stroke="currentColor"
      />
    </svg>
  );
}

/** Alternative checkmark icon with different styling*/
export function AltCheckmarkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <rect width="24" height="24" rx="12" fill="#FDEAD7" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M17.0965 7.39004L9.9365 14.3L8.0365 12.27C7.6865 11.94 7.1365 11.92 6.7365 12.2C6.3465 12.49 6.2365 13 6.4765 13.41L8.7265 17.07C8.9465 17.41 9.3265 17.62 9.7565 17.62C10.1665 17.62 10.5565 17.41 10.7765 17.07C11.1365 16.6 18.0065 8.41004 18.0065 8.41004C18.9065 7.49004 17.8165 6.68004 17.0965 7.38004V7.39004Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** This one doesnt have a circle around it. Its a clean version */
export function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={"100%"}
      height={"100%"}
      viewBox="0 0 18 13"
      fill="none"
      {...props}
    >
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17 1 6 12 1 7"
      />
    </svg>
  );
}

export function SuccessIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={20}
      height={20}
      fill="none"
      {...props}
    >
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.667}
        d="m7.5 10 1.667 1.667 3.75-3.75M6.11 3.182A3.193 3.193 0 0 0 7.93 2.43a3.193 3.193 0 0 1 4.142 0c.512.436 1.148.7 1.818.753a3.193 3.193 0 0 1 2.929 2.93c.053.67.317 1.305.752 1.817a3.193 3.193 0 0 1 0 4.142 3.194 3.194 0 0 0-.752 1.818 3.193 3.193 0 0 1-2.93 2.929 3.194 3.194 0 0 0-1.817.752 3.193 3.193 0 0 1-4.142 0 3.194 3.194 0 0 0-1.818-.752 3.193 3.193 0 0 1-2.929-2.93 3.194 3.194 0 0 0-.753-1.817 3.193 3.193 0 0 1 0-4.142c.436-.512.7-1.148.753-1.818a3.193 3.193 0 0 1 2.93-2.929Z"
      />
    </svg>
  );
}

export function GreenCheckMarkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="66"
      height="66"
      viewBox="0 0 66 66"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <rect x="5" y="5" width="56" height="56" rx="28" fill="#D1FADF" />
      <path
        d="M27.7499 33L31.2499 36.5L38.2499 29.5M44.6666 33C44.6666 39.4433 39.4432 44.6666 32.9999 44.6666C26.5566 44.6666 21.3333 39.4433 21.3333 33C21.3333 26.5567 26.5566 21.3333 32.9999 21.3333C39.4432 21.3333 44.6666 26.5567 44.6666 33Z"
        stroke="#039855"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="5"
        y="5"
        width="56"
        height="56"
        rx="28"
        stroke="#ECFDF3"
        strokeWidth="10"
      />
    </svg>
  );
}

export function SearchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={18}
      height={18}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="m16.5 16.5-3.625-3.625m1.958-4.708a6.667 6.667 0 1 1-13.333 0 6.667 6.667 0 0 1 13.333 0Z"
        stroke="currentColor"
        strokeWidth={1.667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function XIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={10}
      height={10}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M9 1 1 9m0-8 8 8"
        stroke="currentColor"
        strokeWidth={1.333}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const AssetsIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M18.5 6.278 10 11m0 0L1.5 6.278M10 11v9.5m9-5.441V6.94c0-.342 0-.514-.05-.666a1 1 0 0 0-.215-.364c-.109-.119-.258-.202-.558-.368l-7.4-4.111c-.284-.158-.425-.237-.575-.268a1 1 0 0 0-.403 0c-.15.031-.292.11-.576.268l-7.4 4.11c-.3.167-.45.25-.558.369a1 1 0 0 0-.215.364C1 6.427 1 6.599 1 6.94v8.118c0 .342 0 .514.05.666a1 1 0 0 0 .215.364c.109.119.258.202.558.368l7.4 4.111c.284.158.425.237.576.267.132.028.27.028.402 0 .15-.03.292-.11.576-.267l7.4-4.11c.3-.167.45-.25.558-.369a1 1 0 0 0 .215-.364c.05-.152.05-.324.05-.666Z"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const RefreshIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width={22}
    height={20}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M7.547 17.767A8.5 8.5 0 0 0 18.362 5.75l-.25-.433M3.638 14.25A8.5 8.5 0 0 1 14.453 2.233m-12.96 12.1 2.732.733.733-2.732m12.085-4.668.732-2.732 2.732.732"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const CoinsIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={20}
    height={20}
    fill="none"
    {...props}
  >
    <g clipPath="url(#a)">
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.667}
        d="M13.281 13.281A5.834 5.834 0 1 0 6.72 6.72m6.614 5.781a5.833 5.833 0 1 1-11.666 0 5.833 5.833 0 0 1 11.666 0Z"
      />
    </g>
    <defs>
      <clipPath id="a">
        <path fill="currentColor" d="M0 0h20v20H0z" />
      </clipPath>
    </defs>
  </svg>
);

export function CategoriesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M7 7H7.01M1 4.2L1 8.67451C1 9.1637 1 9.40829 1.05526 9.63846C1.10425 9.84253 1.18506 10.0376 1.29472 10.2166C1.4184 10.4184 1.59135 10.5914 1.93726 10.9373L9.60589 18.6059C10.7939 19.7939 11.388 20.388 12.0729 20.6105C12.6755 20.8063 13.3245 20.8063 13.927 20.6105C14.612 20.388 15.2061 19.7939 16.3941 18.6059L18.6059 16.3941C19.7939 15.2061 20.388 14.612 20.6105 13.927C20.8063 13.3245 20.8063 12.6755 20.6105 12.0729C20.388 11.388 19.7939 10.7939 18.6059 9.60589L10.9373 1.93726C10.5914 1.59135 10.4184 1.4184 10.2166 1.29472C10.0376 1.18506 9.84253 1.10425 9.63846 1.05526C9.40829 1 9.1637 1 8.67452 1L4.2 1C3.0799 1 2.51984 1 2.09202 1.21799C1.7157 1.40973 1.40973 1.71569 1.21799 2.09202C1 2.51984 1 3.07989 1 4.2ZM7.5 7C7.5 7.27614 7.27614 7.5 7 7.5C6.72386 7.5 6.5 7.27614 6.5 7C6.5 6.72386 6.72386 6.5 7 6.5C7.27614 6.5 7.5 6.72386 7.5 7Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SwitchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M7 1V19M5.8 1H14.2C15.8802 1 16.7202 1 17.362 1.32698C17.9265 1.6146 18.3854 2.07354 18.673 2.63803C19 3.27976 19 4.11984 19 5.8V14.2C19 15.8802 19 16.7202 18.673 17.362C18.3854 17.9265 17.9265 18.3854 17.362 18.673C16.7202 19 15.8802 19 14.2 19H5.8C4.11984 19 3.27976 19 2.63803 18.673C2.07354 18.3854 1.6146 17.9265 1.32698 17.362C1 16.7202 1 15.8802 1 14.2V5.8C1 4.11984 1 3.27976 1.32698 2.63803C1.6146 2.07354 2.07354 1.6146 2.63803 1.32698C3.27976 1 4.11984 1 5.8 1Z"
        stroke="currentColor"
        strokeWidth="1.66667"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ActiveSwitchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M9 3V21M7.8 3H16.2C17.8802 3 18.7202 3 19.362 3.32698C19.9265 3.6146 20.3854 4.07354 20.673 4.63803C21 5.27976 21 6.11984 21 7.8V16.2C21 17.8802 21 18.7202 20.673 19.362C20.3854 19.9265 19.9265 20.3854 19.362 20.673C18.7202 21 17.8802 21 16.2 21H7.8C6.11984 21 5.27976 21 4.63803 20.673C4.07354 20.3854 3.6146 19.9265 3.32698 19.362C3 18.7202 3 17.8802 3 16.2V7.8C3 6.11984 3 5.27976 3.32698 4.63803C3.6146 4.07354 4.07354 3.6146 4.63803 3.32698C5.27976 3 6.11984 3 7.8 3Z"
        stroke="currentColor"
        strokeWidth="1.66667"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 6C3 4.34315 4.34315 3 6 3H9V21H6C4.34315 21 3 19.6569 3 18V6Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function ShelfTypography(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="61"
      height="21"
      viewBox="0 0 61 21"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M12.6464 10.4013L8.98113 10.6263C8.91827 10.312 8.78265 10.0309 8.57755 9.77614C8.37246 9.52143 8.1012 9.31964 7.76379 9.16416C7.42969 9.012 7.02943 8.93261 6.56631 8.93261C5.94441 8.93261 5.42175 9.06162 4.99833 9.32295C4.57491 9.58428 4.3599 9.9283 4.3599 10.3616C4.3599 10.7057 4.49883 10.9968 4.77339 11.235C5.04796 11.4731 5.52099 11.665 6.19251 11.8072L8.8058 12.3332C10.2084 12.621 11.2537 13.0841 11.9451 13.7225C12.6331 14.361 12.9771 15.2012 12.9771 16.2399C12.9771 17.186 12.6993 18.0163 12.1468 18.7308C11.5911 19.4453 10.8336 20.0011 9.87097 20.398C8.90835 20.795 7.80349 20.9934 6.54977 20.9934C4.63777 20.9934 3.11941 20.5932 1.98809 19.796C0.856764 18.9987 0.19517 17.9071 0 16.531L3.93648 16.3259C4.05557 16.9081 4.34336 17.3514 4.79986 17.6557C5.25636 17.96 5.84187 18.1122 6.55639 18.1122C7.27091 18.1122 7.82334 17.9766 8.25337 17.702C8.68341 17.4308 8.90174 17.0768 8.90504 16.6435C8.89843 16.2796 8.74626 15.9819 8.44524 15.747C8.14421 15.5121 7.68109 15.3335 7.05589 15.2078L4.55507 14.7083C3.14587 14.4271 2.09725 13.9376 1.4125 13.2429C0.727751 12.5482 0.383725 11.6617 0.383725 10.5833C0.383725 9.65705 0.635128 8.85652 1.14125 8.18831C1.64406 7.5168 2.35527 7.00076 3.27489 6.63688C4.19119 6.273 5.26959 6.09106 6.50346 6.09106C8.32615 6.09106 9.7618 6.4781 10.8137 7.24554C11.8624 8.0163 12.4743 9.06493 12.6497 10.3947L12.6464 10.4013Z"
        fill="#252422"
      />
      <path
        d="M18.9744 12.3729V20.7189H14.9718V1.47314H18.862V8.83006H19.0307C19.3549 7.9766 19.8841 7.3084 20.6086 6.82212C21.3363 6.33585 22.246 6.09437 23.3443 6.09437C24.3466 6.09437 25.2232 6.3127 25.9708 6.74604C26.7184 7.18269 27.3006 7.80459 27.7174 8.61504C28.1342 9.42549 28.3393 10.3947 28.3327 11.5227V20.7123H24.33V12.2373C24.3366 11.3474 24.1117 10.6561 23.6585 10.1599C23.2053 9.66367 22.5702 9.41888 21.7564 9.41888C21.2106 9.41888 20.731 9.53466 20.3142 9.76621C19.8974 9.99777 19.5732 10.3352 19.3383 10.7751C19.1034 11.2151 18.9844 11.7477 18.9777 12.3696L18.9744 12.3729Z"
        fill="#252422"
      />
      <path
        d="M37.5421 21.0001C36.0568 21.0001 34.78 20.699 33.7115 20.0937C32.643 19.4883 31.8226 18.6315 31.2438 17.5201C30.6682 16.4086 30.3804 15.092 30.3804 13.5671C30.3804 12.0421 30.6682 10.7784 31.2438 9.65704C31.8193 8.53564 32.6331 7.66234 33.6817 7.03382C34.7303 6.40862 35.9642 6.09436 37.38 6.09436C38.3327 6.09436 39.2193 6.24653 40.0429 6.55086C40.8666 6.85519 41.5878 7.31169 42.203 7.91705C42.8216 8.52571 43.3013 9.28655 43.6453 10.2062C43.9893 11.1258 44.1614 12.1976 44.1614 13.4248V14.5231H31.9715V12.0421H40.3903C40.3903 11.4665 40.2646 10.9538 40.0132 10.5105C39.7618 10.0672 39.4177 9.71658 38.9745 9.46187C38.5345 9.20716 38.0218 9.08145 37.4363 9.08145C36.8508 9.08145 36.2917 9.22039 35.8253 9.49826C35.3589 9.77613 34.995 10.1499 34.7303 10.6163C34.4657 11.0828 34.3334 11.6021 34.3268 12.1711V14.5297C34.3268 15.2442 34.4591 15.8595 34.727 16.3821C34.9917 16.9015 35.3721 17.3017 35.8584 17.5862C36.3479 17.8674 36.9268 18.0097 37.5983 18.0097C38.0416 18.0097 38.4518 17.9468 38.819 17.8211C39.1895 17.6954 39.5037 17.5068 39.7684 17.2587C40.033 17.0073 40.2315 16.6997 40.3704 16.3391H44.072C43.8835 17.2323 43.4998 18.2478 42.9209 18.9094C42.342 19.571 41.5944 20.0837 40.6847 20.4509C39.7717 20.8181 38.7231 21.0001 37.5322 21.0001H37.5421Z"
        fill="#252422"
      />
      <path
        d="M50.2546 1.47314V20.7189H46.252V1.47314H50.2546Z"
        fill="#252422"
      />
      <path
        d="M59.6889 6.28292V9.28986H52.9109V6.28292H59.6889ZM52.8182 20.7189V5.24091C52.8182 4.1956 53.0233 3.3256 53.4335 2.63755C53.8437 1.94949 54.4061 1.43014 55.1206 1.08611C55.8351 0.742082 56.6456 0.570068 57.5552 0.570068C58.1705 0.570068 58.7329 0.61638 59.2423 0.712311C59.7517 0.808242 60.1321 0.890941 60.3836 0.967024L59.669 3.97396C59.5136 3.92435 59.3184 3.87803 59.0901 3.83172C58.8619 3.78872 58.627 3.76556 58.3888 3.76556C57.8 3.76556 57.3898 3.90119 57.1583 4.17575C56.9267 4.45031 56.811 4.82742 56.811 5.317V20.7189H52.8182Z"
        fill="#252422"
      />
    </svg>
  );
}

export function BarCodeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="18"
      height="19"
      viewBox="0 0 18 19"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M4.83333 9.99999H9V14.1667M1.50833 9.99999H1.5M5.675 14.1667H5.66667M9.00833 17.5H9M16.5083 9.99999H16.5M1.5 14.1667H2.75M11.9167 9.99999H13.5833M1.5 17.5H5.66667M9 1.66666V6.66666M13.6667 17.5H15.1667C15.6334 17.5 15.8667 17.5 16.045 17.4092C16.2018 17.3293 16.3293 17.2018 16.4092 17.045C16.5 16.8667 16.5 16.6334 16.5 16.1667V14.6667C16.5 14.1999 16.5 13.9666 16.4092 13.7883C16.3293 13.6315 16.2018 13.504 16.045 13.4242C15.8667 13.3333 15.6334 13.3333 15.1667 13.3333H13.6667C13.2 13.3333 12.9666 13.3333 12.7883 13.4242C12.6315 13.504 12.5041 13.6315 12.4242 13.7883C12.3333 13.9666 12.3333 14.1999 12.3333 14.6667V16.1667C12.3333 16.6334 12.3333 16.8667 12.4242 17.045C12.5041 17.2018 12.6315 17.3293 12.7883 17.4092C12.9666 17.5 13.2 17.5 13.6667 17.5ZM13.6667 6.66666H15.1667C15.6334 6.66666 15.8667 6.66666 16.045 6.57583C16.2018 6.49593 16.3293 6.36845 16.4092 6.21165C16.5 6.03339 16.5 5.80003 16.5 5.33332V3.83332C16.5 3.36661 16.5 3.13326 16.4092 2.955C16.3293 2.7982 16.2018 2.67071 16.045 2.59082C15.8667 2.49999 15.6334 2.49999 15.1667 2.49999H13.6667C13.2 2.49999 12.9666 2.49999 12.7883 2.59082C12.6315 2.67071 12.5041 2.7982 12.4242 2.955C12.3333 3.13326 12.3333 3.36661 12.3333 3.83332V5.33332C12.3333 5.80003 12.3333 6.03339 12.4242 6.21165C12.5041 6.36845 12.6315 6.49593 12.7883 6.57583C12.9666 6.66666 13.2 6.66666 13.6667 6.66666ZM2.83333 6.66666H4.33333C4.80004 6.66666 5.0334 6.66666 5.21166 6.57583C5.36846 6.49593 5.49594 6.36845 5.57584 6.21165C5.66667 6.03339 5.66667 5.80003 5.66667 5.33332V3.83332C5.66667 3.36661 5.66667 3.13326 5.57584 2.955C5.49594 2.7982 5.36846 2.67071 5.21166 2.59082C5.0334 2.49999 4.80004 2.49999 4.33333 2.49999H2.83333C2.36662 2.49999 2.13327 2.49999 1.95501 2.59082C1.79821 2.67071 1.67072 2.7982 1.59083 2.955C1.5 3.13326 1.5 3.36661 1.5 3.83332V5.33332C1.5 5.80003 1.5 6.03339 1.59083 6.21165C1.67072 6.36845 1.79821 6.49593 1.95501 6.57583C2.13327 6.66666 2.36662 6.66666 2.83333 6.66666Z"
        stroke="#344054"
        strokeWidth="1.66667"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PenIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 19 19"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M1.39668 15.0964C1.43497 14.7518 1.45411 14.5795 1.50624 14.4185C1.55249 14.2756 1.61784 14.1396 1.70051 14.0142C1.79369 13.8729 1.91627 13.7504 2.16142 13.5052L13.1667 2.49999C14.0871 1.57951 15.5795 1.57951 16.5 2.49999C17.4205 3.42046 17.4205 4.91285 16.5 5.83332L5.49475 16.8386C5.2496 17.0837 5.12702 17.2063 4.98572 17.2995C4.86035 17.3821 4.72439 17.4475 4.58152 17.4937C4.42048 17.5459 4.24819 17.565 3.90362 17.6033L1.08331 17.9167L1.39668 15.0964Z"
        stroke="currentColor"
        strokeWidth="1.66667"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function VerticalDotsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="4"
      height="16"
      viewBox="0 0 4 16"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M2 8.83334C2.46024 8.83334 2.83334 8.46025 2.83334 8.00001C2.83334 7.53977 2.46024 7.16668 2 7.16668C1.53977 7.16668 1.16667 7.53977 1.16667 8.00001C1.16667 8.46025 1.53977 8.83334 2 8.83334Z"
        stroke="currentColor"
        strokeWidth="1.66667"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2 3.00001C2.46024 3.00001 2.83334 2.62691 2.83334 2.16668C2.83334 1.70644 2.46024 1.33334 2 1.33334C1.53977 1.33334 1.16667 1.70644 1.16667 2.16668C1.16667 2.62691 1.53977 3.00001 2 3.00001Z"
        stroke="currentColor"
        strokeWidth="1.66667"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2 14.6667C2.46024 14.6667 2.83334 14.2936 2.83334 13.8333C2.83334 13.3731 2.46024 13 2 13C1.53977 13 1.16667 13.3731 1.16667 13.8333C1.16667 14.2936 1.53977 14.6667 2 14.6667Z"
        stroke="currentColor"
        strokeWidth="1.66667"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HorizontalDotsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="16"
      height="4"
      viewBox="0 0 16 4"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M7.99998 2.83332C8.46022 2.83332 8.83331 2.46023 8.83331 1.99999C8.83331 1.53975 8.46022 1.16666 7.99998 1.16666C7.53974 1.16666 7.16665 1.53975 7.16665 1.99999C7.16665 2.46023 7.53974 2.83332 7.99998 2.83332Z"
        stroke="#98A2B3"
        strokeWidth="1.66667"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.8333 2.83332C14.2935 2.83332 14.6666 2.46023 14.6666 1.99999C14.6666 1.53975 14.2935 1.16666 13.8333 1.16666C13.3731 1.16666 13 1.53975 13 1.99999C13 2.46023 13.3731 2.83332 13.8333 2.83332Z"
        stroke="#98A2B3"
        strokeWidth="1.66667"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2.16665 2.83332C2.62688 2.83332 2.99998 2.46023 2.99998 1.99999C2.99998 1.53975 2.62688 1.16666 2.16665 1.16666C1.70641 1.16666 1.33331 1.53975 1.33331 1.99999C1.33331 2.46023 1.70641 2.83332 2.16665 2.83332Z"
        stroke="#98A2B3"
        strokeWidth="1.66667"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SadFaceIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="23"
      height="22"
      viewBox="0 0 23 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M15.5 15C15.5 15 14 13 11.5 13C9 13 7.5 15 7.5 15M16.5 8.24C16.105 8.725 15.565 9 15 9C14.435 9 13.91 8.725 13.5 8.24M9.5 8.24C9.105 8.725 8.565 9 8 9C7.435 9 6.91 8.725 6.5 8.24M21.5 11C21.5 16.5228 17.0228 21 11.5 21C5.97715 21 1.5 16.5228 1.5 11C1.5 5.47715 5.97715 1 11.5 1C17.0228 1 21.5 5.47715 21.5 11Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CuboidIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="21"
      height="22"
      viewBox="0 0 21 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M19 6.27783L10.5 11.0001M10.5 11.0001L1.99997 6.27783M10.5 11.0001L10.5 20.5001M19.5 15.0586V6.94153C19.5 6.59889 19.5 6.42757 19.4495 6.27477C19.4049 6.13959 19.3318 6.01551 19.2354 5.91082C19.1263 5.79248 18.9766 5.70928 18.677 5.54288L11.277 1.43177C10.9934 1.27421 10.8516 1.19543 10.7015 1.16454C10.5685 1.13721 10.4315 1.13721 10.2986 1.16454C10.1484 1.19543 10.0066 1.27421 9.72297 1.43177L2.32297 5.54288C2.02345 5.70928 1.87369 5.79248 1.76463 5.91082C1.66816 6.01551 1.59515 6.13959 1.55048 6.27477C1.5 6.42757 1.5 6.59889 1.5 6.94153V15.0586C1.5 15.4013 1.5 15.5726 1.55048 15.7254C1.59515 15.8606 1.66816 15.9847 1.76463 16.0893C1.87369 16.2077 2.02345 16.2909 2.32297 16.4573L9.72297 20.5684C10.0066 20.726 10.1484 20.8047 10.2986 20.8356C10.4315 20.863 10.5685 20.863 10.7015 20.8356C10.8516 20.8047 10.9934 20.726 11.277 20.5684L18.677 16.4573C18.9766 16.2909 19.1263 16.2077 19.2354 16.0893C19.3318 15.9847 19.4049 15.8606 19.4495 15.7254C19.5 15.5726 19.5 15.4013 19.5 15.0586Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function UnlinkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="23"
      height="22"
      viewBox="0 0 23 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M8.5 3V1M14.5 19V21M3.5 8H1.5M19.5 14H21.5M4.41421 3.91421L3 2.5M18.5858 18.0858L20 19.5M11.5 16.6569L9.37868 18.7782C7.81658 20.3403 5.28392 20.3403 3.72183 18.7782C2.15973 17.2161 2.15973 14.6834 3.72183 13.1213L5.84315 11M17.1569 11L19.2782 8.87868C20.8403 7.31658 20.8403 4.78392 19.2782 3.22183C17.7161 1.65973 15.1834 1.65973 13.6213 3.22183L11.5 5.34315"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LinkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={22}
      height={22}
      fill="none"
      {...props}
    >
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M13 10a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
      />
    </svg>
  );
}

export function MapIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="100%"
      height="100%"
      viewBox="0 0 20 20"
      fill="none"
      {...props}
    >
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.667"
        d="m6.667 2.5 6.666 15M2.5 14.167 10 10m-3.5 7.5h7c1.4 0 2.1 0 2.635-.273a2.5 2.5 0 0 0 1.092-1.092c.273-.535.273-1.235.273-2.635v-7c0-1.4 0-2.1-.273-2.635a2.5 2.5 0 0 0-1.092-1.093C15.6 2.5 14.9 2.5 13.5 2.5h-7c-1.4 0-2.1 0-2.635.272a2.5 2.5 0 0 0-1.093 1.093C2.5 4.4 2.5 5.1 2.5 6.5v7c0 1.4 0 2.1.272 2.635a2.5 2.5 0 0 0 1.093 1.092C4.4 17.5 5.1 17.5 6.5 17.5Z"
      />
    </svg>
  );
}

export function QuestionsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 16 16"
      width={16}
      height={16}
      {...props}
    >
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M4.667 5.667H8M4.667 8H10m-3.544 4H10.8c1.12 0 1.68 0 2.108-.218a2 2 0 0 0 .874-.874C14 10.48 14 9.92 14 8.8V5.2c0-1.12 0-1.68-.218-2.108a2 2 0 0 0-.874-.874C12.48 2 11.92 2 10.8 2H5.2c-1.12 0-1.68 0-2.108.218a2 2 0 0 0-.874.874C2 3.52 2 4.08 2 5.2v8.357c0 .355 0 .533.073.624.063.08.16.126.26.126.117 0 .256-.112.533-.334l1.59-1.272c.326-.26.488-.39.669-.482.16-.082.331-.142.508-.178C5.832 12 6.04 12 6.456 12Z"
      />
    </svg>
  );
}

export const WriteIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={20}
    height={20}
    fill="none"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.667}
      d="M9.167 3.333h-3.5c-1.4 0-2.1 0-2.635.273a2.5 2.5 0 0 0-1.093 1.092c-.272.535-.272 1.235-.272 2.635v7c0 1.4 0 2.1.272 2.635a2.5 2.5 0 0 0 1.093 1.093c.534.272 1.234.272 2.635.272h7c1.4 0 2.1 0 2.635-.272.47-.24.852-.622 1.092-1.093.273-.535.273-1.235.273-2.635v-3.5m-10 2.5h1.395c.408 0 .612 0 .803-.046.17-.04.333-.108.482-.2.168-.102.312-.246.6-.535l7.97-7.969a1.768 1.768 0 1 0-2.5-2.5l-7.97 7.97c-.288.287-.432.432-.535.6-.091.149-.159.311-.2.482-.045.191-.045.395-.045.803v1.395Z"
    />
  </svg>
);

export const TagsIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="m19 10-7.594-7.594c-.519-.519-.778-.778-1.081-.964a3.001 3.001 0 0 0-.867-.36C9.112 1 8.746 1 8.012 1H4M1 7.7v1.975c0 .489 0 .733.055.963.05.204.13.4.24.579.123.201.296.374.642.72l7.8 7.8c.792.792 1.188 1.188 1.645 1.337a2 2 0 0 0 1.236 0c.457-.149.853-.545 1.645-1.337l2.474-2.474c.792-.792 1.188-1.188 1.337-1.645a2 2 0 0 0 0-1.236c-.149-.457-.545-.853-1.337-1.645l-7.3-7.3c-.346-.346-.519-.519-.72-.642a2 2 0 0 0-.579-.24c-.23-.055-.474-.055-.963-.055H4.2c-1.12 0-1.68 0-2.108.218a2 2 0 0 0-.874.874C1 6.02 1 6.58 1 7.7Z"
    />
  </svg>
);

export const AddTagsIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={"100%"}
    height={"100%"}
    viewBox="0 0 24 24"
    fill="none"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="m21 10.923-7.594-7.53c-.519-.514-.778-.77-1.081-.955a3.015 3.015 0 0 0-.867-.356C11.112 2 10.745 2 10.012 2H6M3 8.643v1.958c0 .485 0 .727.055.955.05.203.13.396.24.574.123.2.296.371.642.714l7.8 7.734c.792.785 1.188 1.178 1.645 1.325.402.13.834.13 1.236 0 .457-.147.853-.54 1.645-1.325l2.474-2.454c.792-.785 1.188-1.177 1.337-1.63.13-.399.13-.828 0-1.226-.149-.453-.545-.845-1.337-1.63l-7.3-7.238c-.346-.343-.519-.515-.72-.638a2.011 2.011 0 0 0-.579-.237c-.23-.055-.474-.055-.963-.055H6.2c-1.12 0-1.68 0-2.108.216-.376.19-.682.494-.874.867C3 6.977 3 7.533 3 8.643Z"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.3}
      d="M22.714 3.357H18M20.357 1v4.714"
    />
  </svg>
);

export const RemoveTagsIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={"100%"}
    height={"100%"}
    viewBox="0 0 24 24"
    fill="none"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="m20 11-7.594-7.594c-.519-.519-.778-.778-1.081-.964a3.001 3.001 0 0 0-.867-.36C10.112 2 9.746 2 9.012 2H5M2 8.7v1.975c0 .489 0 .733.055.963.05.204.13.4.24.579.123.201.296.374.642.72l7.8 7.8c.792.792 1.188 1.188 1.645 1.337a2 2 0 0 0 1.236 0c.457-.149.853-.545 1.645-1.337l2.474-2.474c.792-.792 1.188-1.188 1.337-1.645a2 2 0 0 0 0-1.236c-.149-.457-.545-.853-1.337-1.645l-7.3-7.3c-.346-.346-.519-.519-.72-.642a2 2 0 0 0-.579-.24c-.23-.055-.474-.055-.963-.055H5.2c-1.12 0-1.68 0-2.108.218a2 2 0 0 0-.874.874C2 7.02 2 7.58 2 8.7Z"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.3}
      d="M22.024 5.024 18.69 1.69m3.334 0L18.69 5.024"
    />
  </svg>
);

export const LocationMarkerIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M9 12C10.6569 12 12 10.6569 12 9C12 7.34315 10.6569 6 9 6C7.34315 6 6 7.34315 6 9C6 10.6569 7.34315 12 9 12Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M9 21C13 17 17 13.4183 17 9C17 4.58172 13.4183 1 9 1C4.58172 1 1 4.58172 1 9C1 13.4183 5 17 9 21Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const GpsMarkerIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={20}
    height={20}
    fill="none"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M16.667 10A6.667 6.667 0 0 1 10 16.667M16.667 10A6.667 6.667 0 0 0 10 3.333M16.667 10h1.666M10 16.667A6.667 6.667 0 0 1 3.333 10M10 16.667v1.666M3.333 10A6.667 6.667 0 0 1 10 3.333M3.333 10H1.667M10 3.333V1.667M12.5 10a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z"
    />
  </svg>
);

export const UserIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="18"
    height="20"
    viewBox="0 0 18 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M17 19C17 17.6044 17 16.9067 16.8278 16.3389C16.44 15.0605 15.4395 14.06 14.1611 13.6722C13.5933 13.5 12.8956 13.5 11.5 13.5H6.5C5.10444 13.5 4.40665 13.5 3.83886 13.6722C2.56045 14.06 1.56004 15.0605 1.17224 16.3389C1 16.9067 1 17.6044 1 19M13.5 5.5C13.5 7.98528 11.4853 10 9 10C6.51472 10 4.5 7.98528 4.5 5.5C4.5 3.01472 6.51472 1 9 1C11.4853 1 13.5 3.01472 13.5 5.5Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const UserXIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M16.5 16L21.5 21M21.5 16L16.5 21M12 15.5H7.5C6.10444 15.5 5.40665 15.5 4.83886 15.6722C3.56045 16.06 2.56004 17.0605 2.17224 18.3389C2 18.9067 2 19.6044 2 21M14.5 7.5C14.5 9.98528 12.4853 12 10 12C7.51472 12 5.5 9.98528 5.5 7.5C5.5 5.01472 7.51472 3 10 3C12.4853 3 14.5 5.01472 14.5 7.5Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ArrowRightIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="15"
    height="14"
    viewBox="0 0 15 14"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M1.66666 7.00008H13.3333M13.3333 7.00008L7.5 1.16675M13.3333 7.00008L7.5 12.8334"
      stroke="currentColor"
      strokeWidth="1.67"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ArrowLeftIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="15"
    height="14"
    viewBox="0 0 15 14"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M13.3333 7.00008H1.66667M1.66667 7.00008L7.5 12.8334M1.66667 7.00008L7.5 1.16675"
      stroke="#344054"
      strokeWidth="1.67"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ChevronLeftDoubleIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width={20}
    height={20}
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M15 14.1666L10.8333 9.99998L15 5.83331M9.16667 14.1666L5 9.99998L9.16667 5.83331"
      stroke="currentColor"
      strokeWidth="1.66667"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const InfoIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M10.0001 13.3333V9.99999M10.0001 6.66666H10.0084M18.3334 9.99999C18.3334 14.6024 14.6025 18.3333 10.0001 18.3333C5.39771 18.3333 1.66675 14.6024 1.66675 9.99999C1.66675 5.39762 5.39771 1.66666 10.0001 1.66666C14.6025 1.66666 18.3334 5.39762 18.3334 9.99999Z"
      stroke="currentColor"
      strokeWidth="1.66667"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const SingleLayerIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="20"
    height="10"
    viewBox="0 0 20 10"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M10.2982 0.982398C10.1889 0.927738 10.1342 0.900409 10.0769 0.889652C10.0261 0.880126 9.97403 0.880126 9.92325 0.889652C9.86592 0.900409 9.81126 0.927738 9.70194 0.982398L1.66675 4.99999L9.70194 9.01759C9.81126 9.07225 9.86592 9.09958 9.92325 9.11033C9.97403 9.11986 10.0261 9.11986 10.0769 9.11033C10.1342 9.09958 10.1889 9.07225 10.2982 9.01759L18.3334 4.99999L10.2982 0.982398Z"
      stroke="currentColor"
      strokeWidth="1.66667"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const DoubleLayerIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M1.66675 12.0833L9.70194 16.1009C9.81126 16.1556 9.86592 16.1829 9.92325 16.1937C9.97403 16.2032 10.0261 16.2032 10.0769 16.1937C10.1342 16.1829 10.1889 16.1556 10.2982 16.1009L18.3334 12.0833M1.66675 7.91666L9.70194 3.89907C9.81126 3.84441 9.86592 3.81708 9.92325 3.80632C9.97403 3.7968 10.0261 3.7968 10.0769 3.80632C10.1342 3.81708 10.1889 3.84441 10.2982 3.89907L18.3334 7.91666L10.2982 11.9343C10.1889 11.9889 10.1342 12.0162 10.0769 12.027C10.0261 12.0365 9.97403 12.0365 9.92325 12.027C9.86592 12.0162 9.81126 11.9889 9.70194 11.9343L1.66675 7.91666Z"
      stroke="currentColor"
      strokeWidth="1.66667"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const MultiLayerIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <g clipPath="url(#clip0_8828_5375)">
      <path
        d="M1.66663 10L9.70182 14.0176C9.81114 14.0723 9.86579 14.0996 9.92313 14.1103C9.97391 14.1199 10.026 14.1199 10.0768 14.1103C10.1341 14.0996 10.1888 14.0723 10.2981 14.0176L18.3333 10M1.66663 14.1667L9.70182 18.1843C9.81114 18.2389 9.86579 18.2663 9.92313 18.277C9.97391 18.2865 10.026 18.2865 10.0768 18.277C10.1341 18.2663 10.1888 18.2389 10.2981 18.1843L18.3333 14.1667M1.66663 5.83334L9.70182 1.81574C9.81114 1.76108 9.86579 1.73375 9.92313 1.723C9.97391 1.71347 10.026 1.71347 10.0768 1.723C10.1341 1.73375 10.1888 1.76108 10.2981 1.81574L18.3333 5.83334L10.2981 9.85093C10.1888 9.90559 10.1341 9.93292 10.0768 9.94368C10.026 9.9532 9.97391 9.9532 9.92313 9.94368C9.86579 9.93292 9.81114 9.90559 9.70182 9.85093L1.66663 5.83334Z"
        stroke="currentColor"
        strokeWidth="1.66667"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
    <defs>
      <clipPath id="clip0_8828_5375">
        <rect width="20" height="20" fill="white" />
      </clipPath>
    </defs>
  </svg>
);

export const EyeIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="8%"
    height="8%"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="M2.42 12.713c-.136-.215-.204-.323-.242-.49a1.173 1.173 0 010-.446c.038-.167.106-.274.242-.49C3.546 9.505 6.895 5 12 5s8.455 4.505 9.58 6.287c.137.215.205.323.243.49.029.125.029.322 0 .446-.038.167-.106.274-.242.49C20.455 14.495 17.105 19 12 19c-5.106 0-8.455-4.505-9.58-6.287z"
    ></path>
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="M12 15a3 3 0 100-6 3 3 0 000 6z"
    ></path>
  </svg>
);

export const EyeOffIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="8%"
    height="8%"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      stroke="#000"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="M10.743 5.092C11.149 5.032 11.569 5 12 5c5.105 0 8.455 4.505 9.58 6.287.137.215.205.323.243.49.029.125.029.322 0 .447-.038.166-.107.274-.244.492-.3.474-.757 1.141-1.363 1.865M6.724 6.715c-2.162 1.467-3.63 3.504-4.303 4.57-.137.217-.205.325-.243.492a1.173 1.173 0 000 .446c.038.167.106.274.242.49C3.546 14.495 6.895 19 12 19c2.059 0 3.832-.732 5.289-1.723M3 3l18 18M9.88 9.879a3 3 0 104.243 4.243"
    ></path>
  </svg>
);

export const HelpIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <g clipPath="url(#clip0_9433_40924)">
      <path
        d="M6.05992 6.00016C6.21665 5.55461 6.52602 5.1789 6.93322 4.93958C7.34042 4.70027 7.81918 4.61279 8.2847 4.69264C8.75022 4.77249 9.17246 5.01451 9.47664 5.37585C9.78081 5.73718 9.94729 6.19451 9.94659 6.66683C9.94659 8.00016 7.94659 8.66683 7.94659 8.66683M7.99992 11.3335H8.00659M14.6666 8.00016C14.6666 11.6821 11.6818 14.6668 7.99992 14.6668C4.31802 14.6668 1.33325 11.6821 1.33325 8.00016C1.33325 4.31826 4.31802 1.3335 7.99992 1.3335C11.6818 1.3335 14.6666 4.31826 14.6666 8.00016Z"
        stroke="currentColor"
        strokeWidth="1.33333"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
    <defs>
      <clipPath id="clip0_9433_40924">
        <rect width="16" height="16" fill="white" />
      </clipPath>
    </defs>
  </svg>
);

export const DuplicateIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M1.66669 4.33329C1.66669 3.39987 1.66669 2.93316 1.84834 2.57664C2.00813 2.26304 2.2631 2.00807 2.5767 1.84828C2.93322 1.66663 3.39993 1.66663 4.33335 1.66663H10.6667C11.6001 1.66663 12.0668 1.66663 12.4233 1.84828C12.7369 2.00807 12.9919 2.26304 13.1517 2.57664C13.3334 2.93316 13.3334 3.39987 13.3334 4.33329V10.6666C13.3334 11.6 13.3334 12.0668 13.1517 12.4233C12.9919 12.7369 12.7369 12.9918 12.4233 13.1516C12.0668 13.3333 11.6001 13.3333 10.6667 13.3333H4.33335C3.39993 13.3333 2.93322 13.3333 2.5767 13.1516C2.2631 12.9918 2.00813 12.7369 1.84834 12.4233C1.66669 12.0668 1.66669 11.6 1.66669 10.6666V4.33329Z"
      stroke="currentColor"
      strokeWidth="1.66667"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M6.66669 9.33329C6.66669 8.39987 6.66669 7.93316 6.84834 7.57664C7.00813 7.26304 7.2631 7.00807 7.5767 6.84828C7.93322 6.66663 8.39993 6.66663 9.33335 6.66663H15.6667C16.6001 6.66663 17.0668 6.66663 17.4233 6.84828C17.7369 7.00807 17.9919 7.26304 18.1517 7.57664C18.3334 7.93316 18.3334 8.39987 18.3334 9.33329V15.6666C18.3334 16.6 18.3334 17.0668 18.1517 17.4233C17.9919 17.7369 17.7369 17.9918 17.4233 18.1516C17.0668 18.3333 16.6001 18.3333 15.6667 18.3333H9.33335C8.39993 18.3333 7.93322 18.3333 7.5767 18.1516C7.2631 17.9918 7.00813 17.7369 6.84834 17.4233C6.66669 17.0668 6.66669 16.6 6.66669 15.6666V9.33329Z"
      stroke="currentColor"
      strokeWidth="1.66667"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const PrintIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M18 7V5.2C18 4.0799 18 3.51984 17.782 3.09202C17.5903 2.71569 17.2843 2.40973 16.908 2.21799C16.4802 2 15.9201 2 14.8 2H9.2C8.0799 2 7.51984 2 7.09202 2.21799C6.71569 2.40973 6.40973 2.71569 6.21799 3.09202C6 3.51984 6 4.0799 6 5.2V7M6 18C5.07003 18 4.60504 18 4.22354 17.8978C3.18827 17.6204 2.37962 16.8117 2.10222 15.7765C2 15.395 2 14.93 2 14V11.8C2 10.1198 2 9.27976 2.32698 8.63803C2.6146 8.07354 3.07354 7.6146 3.63803 7.32698C4.27976 7 5.11984 7 6.8 7H17.2C18.8802 7 19.7202 7 20.362 7.32698C20.9265 7.6146 21.3854 8.07354 21.673 8.63803C22 9.27976 22 10.1198 22 11.8V14C22 14.93 22 15.395 21.8978 15.7765C21.6204 16.8117 20.8117 17.6204 19.7765 17.8978C19.395 18 18.93 18 18 18M15 10.5H18M9.2 22H14.8C15.9201 22 16.4802 22 16.908 21.782C17.2843 21.5903 17.5903 21.2843 17.782 20.908C18 20.4802 18 19.9201 18 18.8V17.2C18 16.0799 18 15.5198 17.782 15.092C17.5903 14.7157 17.2843 14.4097 16.908 14.218C16.4802 14 15.9201 14 14.8 14H9.2C8.0799 14 7.51984 14 7.09202 14.218C6.71569 14.4097 6.40973 14.7157 6.21799 15.092C6 15.5198 6 16.0799 6 17.2V18.8C6 19.9201 6 20.4802 6.21799 20.908C6.40973 21.2843 6.71569 21.5903 7.09202 21.782C7.51984 22 8.07989 22 9.2 22Z"
      stroke="#667085"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const DownloadIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M4 16.2422C2.79401 15.435 2 14.0602 2 12.5C2 10.1564 3.79151 8.23129 6.07974 8.01937C6.54781 5.17213 9.02024 3 12 3C14.9798 3 17.4522 5.17213 17.9203 8.01937C20.2085 8.23129 22 10.1564 22 12.5C22 14.0602 21.206 15.435 20 16.2422M8 17L12 21M12 21L16 17M12 21V12"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const Profile = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 16 16"
    width={16}
    height={16}
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      d="M13.333 14c0-.93 0-1.396-.114-1.774a2.666 2.666 0 0 0-1.778-1.778c-.379-.115-.844-.115-1.774-.115H6.333c-.93 0-1.395 0-1.774.115a2.666 2.666 0 0 0-1.777 1.778c-.115.378-.115.844-.115 1.774M11 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
    />
  </svg>
);

export const ScanQRIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M8.66519 11.8421H11.9967V15.2632M6.00666 11.8421H6M9.33815 15.2632H9.33148M12.0033 18H11.9967M18 11.8421H17.9933M6 15.2632H6.99944M14.3287 11.8421H15.6613M6 18H9.33148M11.9967 5V9.10526M15.7279 18H16.9273C17.3004 18 17.487 18 17.6295 17.9254C17.7549 17.8598 17.8568 17.7552 17.9207 17.6264C17.9933 17.4801 17.9933 17.2885 17.9933 16.9053V15.6737C17.9933 15.2905 17.9933 15.0989 17.9207 14.9525C17.8568 14.8238 17.7549 14.7191 17.6295 14.6535C17.487 14.5789 17.3004 14.5789 16.9273 14.5789H15.7279C15.3548 14.5789 15.1682 14.5789 15.0257 14.6535C14.9003 14.7191 14.7984 14.8238 14.7345 14.9525C14.6619 15.0989 14.6619 15.2905 14.6619 15.6737V16.9053C14.6619 17.2885 14.6619 17.4801 14.7345 17.6264C14.7984 17.7552 14.9003 17.8598 15.0257 17.9254C15.1682 18 15.3548 18 15.7279 18ZM15.7279 9.10526H16.9273C17.3004 9.10526 17.487 9.10526 17.6295 9.03069C17.7549 8.96509 17.8568 8.86042 17.9207 8.73168C17.9933 8.58532 17.9933 8.39372 17.9933 8.01053V6.77895C17.9933 6.39575 17.9933 6.20416 17.9207 6.0578C17.8568 5.92905 17.7549 5.82438 17.6295 5.75879C17.487 5.68421 17.3004 5.68421 16.9273 5.68421H15.7279C15.3548 5.68421 15.1682 5.68421 15.0257 5.75879C14.9003 5.82438 14.7984 5.92905 14.7345 6.0578C14.6619 6.20416 14.6619 6.39575 14.6619 6.77895V8.01053C14.6619 8.39372 14.6619 8.58532 14.7345 8.73168C14.7984 8.86042 14.9003 8.96509 15.0257 9.03069C15.1682 9.10526 15.3548 9.10526 15.7279 9.10526ZM7.06607 9.10526H8.26541C8.63857 9.10526 8.82515 9.10526 8.96768 9.03069C9.09305 8.96509 9.19498 8.86042 9.25886 8.73168C9.33148 8.58532 9.33148 8.39372 9.33148 8.01053V6.77895C9.33148 6.39575 9.33148 6.20416 9.25886 6.0578C9.19498 5.92905 9.09305 5.82438 8.96768 5.75879C8.82515 5.68421 8.63857 5.68421 8.26541 5.68421H7.06607C6.69291 5.68421 6.50633 5.68421 6.3638 5.75879C6.23843 5.82438 6.1365 5.92905 6.07262 6.0578C6 6.20416 6 6.39575 6 6.77895V8.01053C6 8.39372 6 8.58532 6.07262 8.73168C6.1365 8.86042 6.23843 8.96509 6.3638 9.03069C6.50633 9.10526 6.69291 9.10526 7.06607 9.10526Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M4 2.75C3.30964 2.75 2.75 3.30964 2.75 4V8C2.75 8.41421 2.41421 8.75 2 8.75C1.58579 8.75 1.25 8.41421 1.25 8V4C1.25 2.48122 2.48122 1.25 4 1.25H8C8.41421 1.25 8.75 1.58579 8.75 2C8.75 2.41421 8.41421 2.75 8 2.75H4ZM15.25 2C15.25 1.58579 15.5858 1.25 16 1.25H20C21.5188 1.25 22.75 2.48122 22.75 4V8C22.75 8.41421 22.4142 8.75 22 8.75C21.5858 8.75 21.25 8.41421 21.25 8V4C21.25 3.30964 20.6904 2.75 20 2.75H16C15.5858 2.75 15.25 2.41421 15.25 2ZM2 15.25C2.41421 15.25 2.75 15.5858 2.75 16V20C2.75 20.6904 3.30964 21.25 4 21.25H8C8.41421 21.25 8.75 21.5858 8.75 22C8.75 22.4142 8.41421 22.75 8 22.75H4C2.48122 22.75 1.25 21.5188 1.25 20V16C1.25 15.5858 1.58579 15.25 2 15.25ZM22 15.25C22.4142 15.25 22.75 15.5858 22.75 16V20C22.75 21.5188 21.5188 22.75 20 22.75H16C15.5858 22.75 15.25 22.4142 15.25 22C15.25 21.5858 15.5858 21.25 16 21.25H20C20.6904 21.25 21.25 20.6904 21.25 20V16C21.25 15.5858 21.5858 15.25 22 15.25Z"
      fill="currentColor"
    />
  </svg>
);

export const ShareAssetIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="56"
    height="56"
    viewBox="0 0 56 56"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <rect x="4" y="4" width="48" height="48" rx="24" fill="#FDEAD7" />
    <rect
      x="4"
      y="4"
      width="48"
      height="48"
      rx="24"
      stroke="#FEF6EE"
      strokeWidth="8"
    />
    <path
      d="M30 18.2695V22.4001C30 22.9601 30 23.2401 30.109 23.4541C30.2049 23.6422 30.3578 23.7952 30.546 23.8911C30.7599 24.0001 31.0399 24.0001 31.6 24.0001H35.7305M30 33H24M32 29H24M36 25.9882V33.2C36 34.8802 36 35.7202 35.673 36.362C35.3854 36.9265 34.9265 37.3854 34.362 37.673C33.7202 38 32.8802 38 31.2 38H24.8C23.1198 38 22.2798 38 21.638 37.673C21.0735 37.3854 20.6146 36.9265 20.327 36.362C20 35.7202 20 34.8802 20 33.2V22.8C20 21.1198 20 20.2798 20.327 19.638C20.6146 19.0735 21.0735 18.6146 21.638 18.327C22.2798 18 23.1198 18 24.8 18H28.0118C28.7455 18 29.1124 18 29.4577 18.0829C29.7638 18.1564 30.0564 18.2776 30.3249 18.4421C30.6276 18.6276 30.887 18.887 31.4059 19.4059L34.5941 22.5941C35.113 23.113 35.3724 23.3724 35.5579 23.6751C35.7224 23.9436 35.8436 24.2362 35.9171 24.5423C36 24.8876 36 25.2545 36 25.9882Z"
      stroke="#EF6820"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const CopyIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <g clip-path="url(#clip0_2731_95351)">
      <path
        d="M4.1665 12.5C3.38993 12.5 3.00165 12.5 2.69536 12.3731C2.28698 12.204 1.96253 11.8795 1.79337 11.4711C1.6665 11.1649 1.6665 10.7766 1.6665 10V4.33333C1.6665 3.39991 1.6665 2.9332 1.84816 2.57668C2.00795 2.26308 2.26292 2.00811 2.57652 1.84832C2.93304 1.66667 3.39975 1.66667 4.33317 1.66667H9.99984C10.7764 1.66667 11.1647 1.66667 11.471 1.79354C11.8794 1.96269 12.2038 2.28715 12.373 2.69553C12.4998 3.00181 12.4998 3.3901 12.4998 4.16667M10.1665 18.3333H15.6665C16.5999 18.3333 17.0666 18.3333 17.4232 18.1517C17.7368 17.9919 17.9917 17.7369 18.1515 17.4233C18.3332 17.0668 18.3332 16.6001 18.3332 15.6667V10.1667C18.3332 9.23325 18.3332 8.76654 18.1515 8.41002C17.9917 8.09641 17.7368 7.84145 17.4232 7.68166C17.0666 7.5 16.5999 7.5 15.6665 7.5H10.1665C9.23308 7.5 8.76637 7.5 8.40985 7.68166C8.09625 7.84145 7.84128 8.09641 7.68149 8.41002C7.49984 8.76654 7.49984 9.23325 7.49984 10.1667V15.6667C7.49984 16.6001 7.49984 17.0668 7.68149 17.4233C7.84128 17.7369 8.09625 17.9919 8.40985 18.1517C8.76637 18.3333 9.23308 18.3333 10.1665 18.3333Z"
        stroke="currentColor"
        strokeWidth="1.66667"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
    <defs>
      <clipPath id="clip0_2731_95351"></clipPath>
    </defs>
  </svg>
);

export const SignIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M10.5 9L9.99994 9.54702C9.73473 9.83706 9.37507 10 9.00006 10C8.62505 10 8.2654 9.83706 8.00019 9.54702C7.73461 9.25756 7.37499 9.09503 7.00009 9.09503C6.62519 9.09503 6.26557 9.25756 5.99999 9.54702M1.5 9.99999H2.33727C2.58186 9.99999 2.70416 9.99999 2.81925 9.97236C2.92128 9.94786 3.01883 9.90746 3.1083 9.85263C3.20921 9.79079 3.29569 9.70431 3.46864 9.53136L9.75001 3.24999C10.1642 2.83578 10.1642 2.1642 9.75001 1.74999C9.3358 1.33578 8.66423 1.33578 8.25001 1.74999L1.96863 8.03136C1.79568 8.20431 1.7092 8.29079 1.64736 8.39171C1.59253 8.48118 1.55213 8.57872 1.52763 8.68076C1.5 8.79585 1.5 8.91814 1.5 9.16273V9.99999Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const SendRotatedIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    fill="none"
    {...props}
  >
    <path
      stroke="#667085"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.667"
      d="M8.75 11.25 17.5 2.5m-8.644 9.023 2.19 5.632c.193.496.29.744.429.817.12.063.264.063.384 0 .14-.072.236-.32.43-.816L17.78 3.083c.174-.448.262-.672.214-.815a.417.417 0 0 0-.263-.263c-.143-.048-.367.04-.815.214L2.844 7.711c-.496.194-.744.29-.816.43a.417.417 0 0 0 0 .384c.073.14.32.236.817.429l5.631 2.19c.101.039.151.059.194.089.037.026.07.06.097.097.03.042.05.093.09.193Z"
    />
  </svg>
);

export const SendIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={22}
    height={20}
    fill="none"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9.5 10H4m-.084.291L1.58 17.267c-.184.548-.275.822-.21.99a.5.5 0 0 0 .332.3c.174.05.438-.07.965-.306l16.711-7.52c.515-.232.772-.348.851-.508a.5.5 0 0 0 0-.444c-.08-.16-.336-.276-.85-.508L2.661 1.748c-.525-.237-.788-.355-.962-.306a.5.5 0 0 0-.332.299c-.066.168.025.442.206.988l2.342 7.057c.032.093.047.14.053.188a.5.5 0 0 1 0 .129c-.006.048-.022.095-.053.188Z"
    />
  </svg>
);

export const AddUserIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={22}
    height={20}
    fill="none"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M11 13.5H6.5c-1.396 0-2.093 0-2.661.172a4 4 0 0 0-2.667 2.667C1 16.907 1 17.604 1 19m17 0v-6m-3 3h6M13.5 5.5a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z"
    />
  </svg>
);

export const RemoveUserIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={22}
    height={20}
    fill="none"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="m15.5 14 5 5m0-5-5 5M11 13.5H6.5c-1.396 0-2.093 0-2.661.172a4 4 0 0 0-2.667 2.667C1 16.907 1 17.604 1 19M13.5 5.5a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z"
    />
  </svg>
);

export const ToolIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 22 22"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M14.6314 6.63137C14.2354 6.23535 14.0373 6.03735 13.9632 5.80902C13.8979 5.60817 13.8979 5.39183 13.9632 5.19098C14.0373 4.96265 14.2354 4.76465 14.6314 4.36863L17.4697 1.53026C16.7165 1.18962 15.8804 1 15 1C11.6863 1 9 3.68629 9 7C9 7.49104 9.05899 7.9683 9.17026 8.42509C9.28942 8.91424 9.349 9.15882 9.33842 9.31333C9.32735 9.47509 9.30323 9.56115 9.22863 9.70511C9.15738 9.84262 9.02086 9.97914 8.74782 10.2522L2.5 16.5C1.67157 17.3284 1.67157 18.6716 2.5 19.5C3.32843 20.3284 4.67157 20.3284 5.5 19.5L11.7478 13.2522C12.0209 12.9791 12.1574 12.8426 12.2949 12.7714C12.4388 12.6968 12.5249 12.6727 12.6867 12.6616C12.8412 12.651 13.0858 12.7106 13.5749 12.8297C14.0317 12.941 14.509 13 15 13C18.3137 13 21 10.3137 21 7C21 6.11959 20.8104 5.28347 20.4697 4.53026L17.6314 7.36863C17.2354 7.76465 17.0373 7.96265 16.809 8.03684C16.6082 8.1021 16.3918 8.1021 16.191 8.03684C15.9627 7.96265 15.7646 7.76465 15.3686 7.36863L14.6314 6.63137Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const GraphIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M6 13V15M10 9V15M14 5V15M5.8 19H14.2C15.8802 19 16.7202 19 17.362 18.673C17.9265 18.3854 18.3854 17.9265 18.673 17.362C19 16.7202 19 15.8802 19 14.2V5.8C19 4.11984 19 3.27976 18.673 2.63803C18.3854 2.07354 17.9265 1.6146 17.362 1.32698C16.7202 1 15.8802 1 14.2 1H5.8C4.11984 1 3.27976 1 2.63803 1.32698C2.07354 1.6146 1.6146 2.07354 1.32698 2.63803C1 3.27976 1 4.11984 1 5.8V14.2C1 15.8802 1 16.7202 1.32698 17.362C1.6146 17.9265 2.07354 18.3854 2.63803 18.673C3.27976 19 4.11984 19 5.8 19Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const StarsIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M4.5 22V17M4.5 7V2M2 4.5H7M2 19.5H7M13 3L11.2658 7.50886C10.9838 8.24209 10.8428 8.60871 10.6235 8.91709C10.4292 9.1904 10.1904 9.42919 9.91709 9.62353C9.60871 9.8428 9.24209 9.98381 8.50886 10.2658L4 12L8.50886 13.7342C9.24209 14.0162 9.60871 14.1572 9.91709 14.3765C10.1904 14.5708 10.4292 14.8096 10.6235 15.0829C10.8428 15.3913 10.9838 15.7579 11.2658 16.4911L13 21L14.7342 16.4911C15.0162 15.7579 15.1572 15.3913 15.3765 15.0829C15.5708 14.8096 15.8096 14.5708 16.0829 14.3765C16.3913 14.1572 16.7579 14.0162 17.4911 13.7342L22 12L17.4911 10.2658C16.7579 9.98381 16.3913 9.8428 16.0829 9.62353C15.8096 9.42919 15.5708 9.1904 15.3765 8.91709C15.1572 8.60871 15.0162 8.24209 14.7342 7.50886L13 3Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const CalendarIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={20}
    height={22}
    fill="none"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M19 7H1m13-6v3M6 1v3m4 13v-6m-3 3h6m-7.2 7h8.4c1.68 0 2.52 0 3.162-.327a3 3 0 0 0 1.311-1.311C19 18.72 19 17.88 19 16.2V7.8c0-1.68 0-2.52-.327-3.162a3 3 0 0 0-1.311-1.311C16.72 3 15.88 3 14.2 3H5.8c-1.68 0-2.52 0-3.162.327a3 3 0 0 0-1.311 1.311C1 5.28 1 6.12 1 7.8v8.4c0 1.68 0 2.52.327 3.162a3 3 0 0 0 1.311 1.311C3.28 21 4.12 21 5.8 21Z"
    />
  </svg>
);

export const BookingsIcon = () => <CalendarPlus />;

export const CustomFiedIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M8.66732 4.66667H3.46732C2.72058 4.66667 2.34721 4.66667 2.062 4.81199C1.81111 4.93982 1.60714 5.1438 1.47931 5.39468C1.33398 5.67989 1.33398 6.05326 1.33398 6.8V9.2C1.33398 9.94674 1.33398 10.3201 1.47931 10.6053C1.60714 10.8562 1.81111 11.0602 2.062 11.188C2.34721 11.3333 2.72058 11.3333 3.46732 11.3333H8.66732M11.334 4.66667H12.534C13.2807 4.66667 13.6541 4.66667 13.9393 4.81199C14.1902 4.93982 14.3942 5.1438 14.522 5.39468C14.6673 5.67989 14.6673 6.05326 14.6673 6.8V9.2C14.6673 9.94674 14.6673 10.3201 14.522 10.6053C14.3942 10.8562 14.1902 11.0602 13.9393 11.188C13.6541 11.3333 13.2807 11.3333 12.534 11.3333H11.334M11.334 14L11.334 2M13.0007 2.00001L9.66732 2M13.0007 14L9.66732 14"
      stroke="currentColor"
      strokeWidth="1.33333"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const KitIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="18"
    height="20"
    viewBox="0 0 22 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M15 5C15 4.07003 15 3.60504 14.8978 3.22354C14.6204 2.18827 13.8117 1.37962 12.7765 1.10222C12.395 1 11.93 1 11 1C10.07 1 9.60504 1 9.22354 1.10222C8.18827 1.37962 7.37962 2.18827 7.10222 3.22354C7 3.60504 7 4.07003 7 5M4.2 19H17.8C18.9201 19 19.4802 19 19.908 18.782C20.2843 18.5903 20.5903 18.2843 20.782 17.908C21 17.4802 21 16.9201 21 15.8V8.2C21 7.07989 21 6.51984 20.782 6.09202C20.5903 5.71569 20.2843 5.40973 19.908 5.21799C19.4802 5 18.9201 5 17.8 5H4.2C3.07989 5 2.51984 5 2.09202 5.21799C1.71569 5.40973 1.40973 5.71569 1.21799 6.09202C1 6.51984 1 7.07989 1 8.2V15.8C1 16.9201 1 17.4802 1.21799 17.908C1.40973 18.2843 1.71569 18.5903 2.09202 18.782C2.51984 19 3.0799 19 4.2 19Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const CheckOutIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    width="100%"
    height="100%"
    viewBox="0 0 16 16"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      d="m12.666 14 2-2m0 0-2-2m2 2h-4M8 10.333H5c-.93 0-1.396 0-1.774.115a2.666 2.666 0 0 0-1.778 1.778c-.115.378-.115.844-.115 1.774m8.333-9a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
    />
  </svg>
);

export const CheckInIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    width="100%"
    height="100%"
    viewBox="0 0 16 16"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      d="m12.666 14-2-2m0 0 2-2m-2 2h4M8 10.333H5c-.93 0-1.396 0-1.774.115a2.666 2.666 0 0 0-1.778 1.778c-.115.378-.115.844-.115 1.774m8.333-9a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
    />
  </svg>
);

export function PartialCheckboxIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      fill="none"
      viewBox="0 0 20 20"
      {...props}
    >
      <rect width={19} height={19} x={0.5} y={0.5} fill="#FEF6EE" rx={3.5} />
      <rect width={19} height={19} x={0.5} y={0.5} stroke="#EF6820" rx={3.5} />
      <path
        stroke="#EF6820"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5.917 10h8.166"
      />
    </svg>
  );
}
export const AssetLabel = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    width="18"
    height="20"
    viewBox="0 0 22 20"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M7 12h5v5m-8.99-5H3m5.01 5H8m4.01 4H12m9.01-9H21M3 17h1.5m11-5h2M3 21h5m4-19v6m5.6 13h1.8c.56 0 .84 0 1.054-.109a1 1 0 0 0 .437-.437C21 20.24 21 19.96 21 19.4v-1.8c0-.56 0-.84-.109-1.054a1 1 0 0 0-.437-.437C20.24 16 19.96 16 19.4 16h-1.8c-.56 0-.84 0-1.054.109a1 1 0 0 0-.437.437C16 16.76 16 17.04 16 17.6v1.8c0 .56 0 .84.109 1.054a1 1 0 0 0 .437.437C16.76 21 17.04 21 17.6 21Zm0-13h1.8c.56 0 .84 0 1.054-.109a1 1 0 0 0 .437-.437C21 7.24 21 6.96 21 6.4V4.6c0-.56 0-.84-.109-1.054a1 1 0 0 0-.437-.437C20.24 3 19.96 3 19.4 3h-1.8c-.56 0-.84 0-1.054.109a1 1 0 0 0-.437.437C16 3.76 16 4.04 16 4.6v1.8c0 .56 0 .84.109 1.054a1 1 0 0 0 .437.437C16.76 8 17.04 8 17.6 8Zm-13 0h1.8c.56 0 .84 0 1.054-.109a1 1 0 0 0 .437-.437C8 7.24 8 6.96 8 6.4V4.6c0-.56 0-.84-.109-1.054a1 1 0 0 0-.437-.437C7.24 3 6.96 3 6.4 3H4.6c-.56 0-.84 0-1.054.109a1 1 0 0 0-.437.437C3 3.76 3 4.04 3 4.6v1.8c0 .56 0 .84.109 1.054a1 1 0 0 0 .437.437C3.76 8 4.04 8 4.6 8Z"
    />
  </svg>
);

export const NoPermissionsIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 19 22"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M17 9V5.8c0-1.68 0-2.52-.327-3.162a3 3 0 0 0-1.311-1.311C14.72 1 13.88 1 12.2 1H5.8c-1.68 0-2.52 0-3.162.327a3 3 0 0 0-1.311 1.311C1 3.28 1 4.12 1 5.8v10.4c0 1.68 0 2.52.327 3.162a3 3 0 0 0 1.311 1.311C3.28 21 4.12 21 5.8 21h1.7M10 10H5m3 4H5m8-8H5m11.25 10v-1.75a1.75 1.75 0 1 0-3.5 0V16m-.15 4h3.8c.56 0 .84 0 1.054-.109a1 1 0 0 0 .437-.437C18 19.24 18 18.96 18 18.4v-.8c0-.56 0-.84-.109-1.054a1 1 0 0 0-.437-.437C17.24 16 16.96 16 16.4 16h-3.8c-.56 0-.84 0-1.054.109a1 1 0 0 0-.437.437C11 16.76 11 17.04 11 17.6v.8c0 .56 0 .84.109 1.054a1 1 0 0 0 .437.437C11.76 20 12.04 20 12.6 20Z"
    />
  </svg>
);

export const ScanIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    fill="none"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.667}
      d="M6.667 2.5H6.5c-1.4 0-2.1 0-2.635.272a2.5 2.5 0 0 0-1.093 1.093C2.5 4.4 2.5 5.1 2.5 6.5v.167M6.667 17.5H6.5c-1.4 0-2.1 0-2.635-.273a2.5 2.5 0 0 1-1.093-1.092C2.5 15.6 2.5 14.9 2.5 13.5v-.167m15-6.666V6.5c0-1.4 0-2.1-.273-2.635a2.5 2.5 0 0 0-1.092-1.093C15.6 2.5 14.9 2.5 13.5 2.5h-.167M17.5 13.333v.167c0 1.4 0 2.1-.273 2.635a2.5 2.5 0 0 1-1.092 1.092c-.535.273-1.235.273-2.635.273h-.167M2.5 10h.008m3.742 0h.008m7.492 0h.008M10 10h.008m7.492 0h.008"
    />
  </svg>
);

export const InstallIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="100%"
    height="100%"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M6.66667 10L10 13.3333M10 13.3333L13.3333 10M10 13.3333V6.66667M6.5 17.5H13.5C14.9001 17.5 15.6002 17.5 16.135 17.2275C16.6054 16.9878 16.9878 16.6054 17.2275 16.135C17.5 15.6002 17.5 14.9001 17.5 13.5V6.5C17.5 5.09987 17.5 4.3998 17.2275 3.86502C16.9878 3.39462 16.6054 3.01217 16.135 2.77248C15.6002 2.5 14.9001 2.5 13.5 2.5H6.5C5.09987 2.5 4.3998 2.5 3.86502 2.77248C3.39462 3.01217 3.01217 3.39462 2.77248 3.86502C2.5 4.3998 2.5 5.09987 2.5 6.5V13.5C2.5 14.9001 2.5 15.6002 2.77248 16.135C3.01217 16.6054 3.39462 16.9878 3.86502 17.2275C4.3998 17.5 5.09987 17.5 6.5 17.5Z"
      stroke="#667085"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ColumnsIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={"100%"}
    height={"100%"}
    viewBox="0 0 16 16"
    fill="none"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.25}
      d="M6 2v12m4-12v12M5.2 2h5.6c1.12 0 1.68 0 2.108.218a2 2 0 0 1 .874.874C14 3.52 14 4.08 14 5.2v5.6c0 1.12 0 1.68-.218 2.108a2 2 0 0 1-.874.874C12.48 14 11.92 14 10.8 14H5.2c-1.12 0-1.68 0-2.108-.218a2 2 0 0 1-.874-.874C2 12.48 2 11.92 2 10.8V5.2c0-1.12 0-1.68.218-2.108a2 2 0 0 1 .874-.874C3.52 2 4.08 2 5.2 2Z"
    />
  </svg>
);

export const HandleIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={"100%"}
    height={"100%"}
    viewBox="0 0 8 12"
    fill="none"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.25}
      d="M6.333 2.001a.667.667 0 1 0 0-1.333.667.667 0 0 0 0 1.333ZM6.333 6.668a.667.667 0 1 0 0-1.333.667.667 0 0 0 0 1.333ZM6.333 11.335a.667.667 0 1 0 0-1.334.667.667 0 0 0 0 1.334ZM1.667 2.001a.667.667 0 1 0 0-1.333.667.667 0 0 0 0 1.333ZM1.667 6.668a.667.667 0 1 0 0-1.333.667.667 0 0 0 0 1.333ZM1.667 11.335a.667.667 0 1 0 0-1.334.667.667 0 0 0 0 1.334Z"
    />
  </svg>
);

export const LockIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={"100%"}
    height={"100%"}
    viewBox="0 0 16 16"
    fill="none"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      d="M11.333 6.667V5.333a3.333 3.333 0 0 0-6.667 0v1.334m3.334 3V11m-2.133 3h4.266c1.12 0 1.68 0 2.108-.218a2 2 0 0 0 .874-.874c.218-.428.218-.988.218-2.108v-.933c0-1.12 0-1.68-.218-2.108a2 2 0 0 0-.874-.874c-.428-.218-.988-.218-2.108-.218H5.867c-1.12 0-1.68 0-2.108.218a2 2 0 0 0-.875.874c-.217.428-.217.988-.217 2.108v.933c0 1.12 0 1.68.217 2.108a2 2 0 0 0 .875.874c.427.218.987.218 2.108.218Z"
    />
  </svg>
);

export const ImageIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={"100%"}
    height={"100%"}
    viewBox="0 0 24 24"
    fill="none"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M16.2 21H6.931c-.605 0-.908 0-1.049-.12a.5.5 0 0 1-.173-.42c.014-.183.228-.397.657-.826l8.503-8.503c.396-.396.594-.594.822-.668a1 1 0 0 1 .618 0c.228.074.426.272.822.668L21 15v1.2M16.2 21c1.68 0 2.52 0 3.162-.327a3 3 0 0 0 1.311-1.311C21 18.72 21 17.88 21 16.2M16.2 21H7.8c-1.68 0-2.52 0-3.162-.327a3 3 0 0 1-1.311-1.311C3 18.72 3 17.88 3 16.2V7.8c0-1.68 0-2.52.327-3.162a3 3 0 0 1 1.311-1.311C5.28 3 6.12 3 7.8 3h8.4c1.68 0 2.52 0 3.162.327a3 3 0 0 1 1.311 1.311C21 5.28 21 6.12 21 7.8v8.4M10.5 8.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z"
    />
  </svg>
);

export const UnavailableIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M21 10H3M16 2V6M8 2V6M7.8 22H16.2C17.8802 22 18.7202 22 19.362 21.673C19.9265 21.3854 20.3854 20.9265 20.673 20.362C21 19.7202 21 18.8802 21 17.2V8.8C21 7.11984 21 6.27976 20.673 5.63803C20.3854 5.07354 19.9265 4.6146 19.362 4.32698C18.7202 4 17.8802 4 16.2 4H7.8C6.11984 4 5.27976 4 4.63803 4.32698C4.07354 4.6146 3.6146 5.07354 3.32698 5.63803C3 6.27976 3 7.11984 3 8.8V17.2C3 18.8802 3 19.7202 3.32698 20.362C3.6146 20.9265 4.07354 21.3854 4.63803 21.673C5.27976 22 6.11984 22 7.8 22Z"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M9 13L12 16L15 19M15 13L9 19"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const SortIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={"100%"}
    height={"100%"}
    viewBox="0 0 16 16"
    fill="none"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.25}
      d="M14 8H6m8-4H6m8 8H6M3.333 8A.667.667 0 1 1 2 8a.667.667 0 0 1 1.333 0Zm0-4A.667.667 0 1 1 2 4a.667.667 0 0 1 1.333 0Zm0 8A.667.667 0 1 1 2 12a.667.667 0 0 1 1.333 0Z"
    />
  </svg>
);

export const FilterIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={"100%"}
    height={"100%"}
    viewBox="0 0 16 16"
    fill="none"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.25}
      d="M4 8h8M2 4h12m-8 8h4"
    />
  </svg>
);
export const AvailableIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M21 10H3M16 2V6M8 2V6M9 16L11 18L15.5 13.5M7.8 22H16.2C17.8802 22 18.7202 22 19.362 21.673C19.9265 21.3854 20.3854 20.9265 20.673 20.362C21 19.7202 21 18.8802 21 17.2V8.8C21 7.11984 21 6.27976 20.673 5.63803C20.3854 5.07354 19.9265 4.6146 19.362 4.32698C18.7202 4 17.8802 4 16.2 4H7.8C6.11984 4 5.27976 4 4.63803 4.32698C4.07354 4.6146 3.6146 5.07354 3.32698 5.63803C3 6.27976 3 7.11984 3 8.8V17.2C3 18.8802 3 19.7202 3.32698 20.362C3.6146 20.9265 4.07354 21.3854 4.63803 21.673C5.27976 22 6.11984 22 7.8 22Z"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ChangeIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    fill="none"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M1 15h16m0 0-4-4m4 4-4 4m4-14H1m0 0 4-4M1 5l4 4"
    />
  </svg>
);

export const AlertIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={"100%"}
    height={"100%"}
    fill="none"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 9v4m0 4h.01M10.615 3.892 2.39 18.098c-.456.788-.684 1.182-.65 1.506a1 1 0 0 0 .406.705c.263.191.718.191 1.629.191h16.45c.91 0 1.365 0 1.628-.191a1 1 0 0 0 .407-.705c.034-.324-.195-.718-.65-1.506L13.383 3.892c-.454-.785-.681-1.178-.978-1.31a1 1 0 0 0-.813 0c-.296.132-.523.525-.978 1.31Z"
    />
  </svg>
);
