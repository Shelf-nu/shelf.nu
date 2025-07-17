import React, { useEffect, useRef, useState } from "react";
import { tw } from "~/utils/tw";

export const Divider = ({ className, ...props }: { className?: string }) => {
  const dividerRef = useRef<HTMLDivElement>(null);
  const [hasSiblings, setHasSiblings] = useState(true);

  /** This is to make sure that the element is only rendered when it has both a prev and next sibling */
  useEffect(() => {
    const element = dividerRef.current;
    if (element) {
      const hasPreviousSibling = element.previousElementSibling !== null;
      const hasNextSibling = element.nextElementSibling !== null;
      if (!hasPreviousSibling || !hasNextSibling) {
        setHasSiblings(false);
      }
    }
  }, []);

  if (!hasSiblings) {
    return null;
  }
  return (
    <div
      ref={dividerRef}
      className={tw("bg-color-300 my-2 h-px", className)}
      {...props}
    />
  );
};
