import type { SVGProps } from "react";

type FakeCheckboxProps = SVGProps<SVGSVGElement> & {
  checked?: boolean;
  fillColor?: string;
};

export const FakeCheckbox = ({
  checked,
  fillColor = "#FEF6EE",
  ...svgProps
}: FakeCheckboxProps) =>
  checked ? (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...svgProps}
    >
      <rect
        x="0.5"
        y="0.5"
        width="19"
        height="19"
        rx="5.5"
        fill="var(--bg-muted)"
      />
      <path
        d="M14.6668 6.5L8.25016 12.9167L5.3335 10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="0.5"
        y="0.5"
        width="19"
        height="19"
        rx="5.5"
        stroke="currentColor"
      />
    </svg>
  ) : (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...svgProps}
    >
      <rect
        x="0.5"
        y="0.5"
        width="19"
        height="19"
        rx="5.5"
        fill="var(--bg-muted)"
      />
      <rect
        x="0.5"
        y="0.5"
        width="19"
        height="19"
        rx="5.5"
        stroke="var(--border-color-300)"
      />
    </svg>
  );
