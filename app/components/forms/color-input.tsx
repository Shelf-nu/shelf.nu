import { useState } from "react";
import type { ChangeEvent } from "react";
import { getRandomColor } from "~/utils";
import Input from "./input";

import { Button } from "../shared/button";

export const ColorInput = ({ ...rest }) => {
  const [color, setColor] = useState<string>(`${getRandomColor()}`);

  const handleColorChange = (e: ChangeEvent<HTMLInputElement>) => {
    setColor(() => `${e.target.value}`);
  };

  const handleRefresh = () => {
    setColor(() => `${getRandomColor()}`);
  };

  return (
    <div className="flex items-end gap-1">
      <Button
        icon="refresh"
        variant="secondary"
        size="sm"
        as="a"
        onClick={handleRefresh}
        className="cursor-pointer p-2"
        style={{ backgroundColor: `${color}4D` }}
        title="Generate random color"
      />
      <Input
        label="Hex Color"
        value={color}
        onChange={handleColorChange}
        className="max-w-[100px]"
        {...rest}
      />
    </div>
  );
};
