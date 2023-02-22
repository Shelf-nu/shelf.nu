interface Props {
  /** Size of the hug. Defualt is sm */
  size: "sm" | "md" | "lg" | "xl" | "2xl";

  children: JSX.Element | JSX.Element[];

  className?: string;
}

const sizeClasses: {
  [key in Props["size"]]: string;
} = {
  /** 32px */
  sm: "8",
  /** 40px */
  md: "10",
  /** 44px */
  lg: "11",
  /** 48px */
  xl: "12",
  /** 56px */
  "2xl": "14",
};

export default function IconHug({ size = "sm", children, className }: Props) {
  /** Classes that will add the correct class based on the size passed to the hug
   * The value corresponds to rem, related to sizes of untitled ui
   */
  const sizeClass = sizeClasses[size];
  return (
    <div
      className={`inline-flex w-${sizeClass} h-${sizeClass} items-center justify-center ${className} rounded-lg hover:cursor-pointer hover:bg-[#344054]`}
    >
      {children}
    </div>
  );
}
