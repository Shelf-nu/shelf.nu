import type { ChangeEvent } from "react";
import { useState, useEffect } from "react";
import { darkenColor } from "~/utils/color-contrast";
import { getRandomColor } from "~/utils/get-random-color";
import Input from "./input";

import { Button } from "../shared/button";

export const ColorInput = ({
  colorFromServer,
  ...rest
}: {
  colorFromServer: string;
  [key: string]: any;
}) => {
  const [color, setColor] = useState<string>("");

  useEffect(() => {
    setColor(() => `${colorFromServer}`);
  }, [colorFromServer]);

  const handleColorChange = (e: ChangeEvent<HTMLInputElement>) => {
    setColor(() => `${e.target.value}`);
  };

  const handleRefresh = () => {
    setColor(() => `${getRandomColor()}`);
  };

  // Use darkened color for icon text to match Badge component
  const iconColor = color ? darkenColor(color, 0.5) : undefined;

  return (
    <div className="flex items-end gap-1">
      <Input
        label="Hex Color"
        value={color}
        onChange={handleColorChange}
        className="w-full min-w-[120px] lg:max-w-[120px]"
        {...rest}
      />
      <Button
        icon="refresh"
        variant="secondary"
        size="sm"
        as="a"
        onClick={handleRefresh}
        className="cursor-pointer p-2"
        style={{
          backgroundColor: `${color}33`,
          color: iconColor,
        }}
        title="Generate random color (preview shows how badge will look)"
        data-test-id="generateRandomColor"
      />
    </div>
  );
};
