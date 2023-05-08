import type { ChangeEvent } from "react";
import { atom, useAtom } from "jotai";
import { useHydrateAtoms } from "jotai/utils";
import { getRandomColor } from "~/utils";
import Input from "./input";

import { Button } from "../shared/button";

const colorAtom = atom("");

export const ColorInput = ({
  colorFromServer,
  ...rest
}: {
  colorFromServer: string;
  [key: string]: any;
}) => {
  /** This is needed so the color can be hydrated. the Initial value is generated in the categories.new loader */
  useHydrateAtoms([[colorAtom, colorFromServer]]);
  const [color, setColor] = useAtom(colorAtom);

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
        style={{ backgroundColor: `${color}33` }}
        title="Generate random color"
        data-test-id="generateRandomColor"
      />
      <Input
        label="Hex Color"
        value={color}
        onChange={handleColorChange}
        className="w-full lg:max-w-[100px]"
        {...rest}
      />
    </div>
  );
};
