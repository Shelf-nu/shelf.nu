import type { ChangeEvent } from "react";
import { useState, useEffect } from "react";
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

  return (
    <div className="flex items-end gap-1">
      <Input
        label="Hex Color"
        value={color}
        onChange={handleColorChange}
        className="w-full lg:max-w-[100px]"
        {...rest}
      />
      <Button
        icon="refresh"
        variant="secondary"
        size="sm"
        as="a"
        onClick={handleRefresh}
        className="cursor-pointer p-2.5"
        style={{ backgroundColor: `${color}33` }}
        title="Generate random color"
        data-test-id="generateRandomColor"
      />
    </div>
  );
};
