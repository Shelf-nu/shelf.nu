import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { tw } from "~/utils/tw";
import { Button } from "./button";
import { MobileStyles } from "../dynamic-select/dynamic-select";
import { CheckIcon } from "../icons/library";
import When from "../when/when";

export type SelectItem = { id: string; label: string } & { [key: string]: any };

type SelectProps = {
  className?: string;
  style?: React.CSSProperties;
  defaultValue?: string;
  /**
   * Name for the input field
   */
  name: string;
  items: SelectItem[];
  /**
   * Weather to allow clearing the value
   * default to `true`
   */
  allowClear?: boolean;
  disabled?: boolean;
  placeholder?: string;
  onChange?: (value: string) => void;
  /**
   * Weather to close the select menu after selecting a value or not
   */
  closeOnSelect?: boolean;
};

export default function Select({
  className,
  style,
  defaultValue,
  name,
  items,
  allowClear = true,
  disabled,
  placeholder = "Select item",
  onChange,
  closeOnSelect = false,
}: SelectProps) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [selectedValue, setSelectedValue] = useState<string | undefined>(
    defaultValue
  );
  const triggerRef = useRef<HTMLDivElement>(null);

  function handleItemChange(id: string) {
    if (allowClear && selectedValue === id) {
      setSelectedValue(undefined);
    } else {
      setSelectedValue(id);
    }

    onChange && onChange(id);

    if (closeOnSelect) {
      setIsPopoverOpen(false);
    }
  }

  useEffect(
    function updateSelectedIfDefaultValueChange() {
      setSelectedValue(defaultValue);
    },
    [defaultValue]
  );

  return (
    <div className={tw("relative w-full", className)} style={style}>
      <input
        key={`${selectedValue}-${defaultValue}`}
        type="hidden"
        value={selectedValue}
        name={name}
      />
      <MobileStyles open={isPopoverOpen} />

      <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
        <div className="flex w-full items-center gap-x-2">
          <PopoverTrigger disabled={disabled} asChild>
            <div
              ref={triggerRef}
              className="flex w-full select-none items-center justify-between rounded border border-gray-300 px-[14px] py-2 text-[16px] text-gray-500 hover:cursor-pointer disabled:opacity-50"
            >
              {items.find((i) => i.id === selectedValue)?.label ?? placeholder}
              <ChevronDownIcon />
            </div>
          </PopoverTrigger>

          <When truthy={allowClear && !!selectedValue}>
            <Button
              icon="x"
              variant="secondary"
              type="button"
              onClick={() => {
                setSelectedValue(undefined);
              }}
            />
          </When>
        </div>

        <PopoverPortal>
          <PopoverContent
            className={tw(
              "z-[100] overflow-y-auto rounded-md border border-gray-300 bg-white outline-none",
              className
            )}
            style={{
              ...style,
              width: triggerRef?.current?.clientWidth,
            }}
            align="center"
            sideOffset={5}
          >
            <div className="max-h-[320px] divide-y overflow-y-auto">
              {items.map((item) => (
                <div
                  key={item.id}
                  className={tw(
                    "flex cursor-pointer select-none items-center justify-between gap-4 px-6 py-4 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-gray-100 focus:bg-gray-100",
                    item.id === selectedValue && "bg-gray-100"
                  )}
                  onClick={() => {
                    handleItemChange(item.id);
                  }}
                >
                  <div className="flex items-center truncate text-sm font-medium">
                    {item.label}
                  </div>

                  <When truthy={item.id === selectedValue}>
                    <CheckIcon className="text-primary" />
                  </When>
                </div>
              ))}
            </div>
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    </div>
  );
}
