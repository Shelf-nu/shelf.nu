/**
 * Color Input
 *
 * The color field of the category and tag forms: a swatch that opens the
 * browser's native color picker, the hex text field (the value the form
 * submits), and a button that picks a random color.
 *
 * The swatch and the hex field stay in step: picking a color fills the hex
 * field, and typing a valid hex moves the swatch. The swatch has no `name`, so
 * only the hex field is submitted and validated (`hexColorSchema` /
 * `optionalHexColorSchema`).
 *
 * Focusing the hex field opens the picker too. Safari and Firefox show it as a
 * separate window, and closing that window hands focus back to the hex field;
 * that return must not reopen the picker, or the hex could never be typed.
 *
 * @see {@link file://./../../utils/label-form-fields.ts}
 */
import type { ChangeEvent, FocusEvent } from "react";
import { useRef, useState } from "react";
import { darkenColor } from "~/utils/color-contrast";
import { getRandomColor } from "~/utils/get-random-color";
import { hexColorSchema } from "~/utils/label-form-fields";
import { tw } from "~/utils/tw";
import Input from "./input";

import { Button } from "../shared/button";

/** What the native picker shows while the hex field holds no valid color */
const SWATCH_FALLBACK = "#000000";

/**
 * Reads a typed value as a stored `#rrggbb` color.
 *
 * @param value - The hex field's text
 * @returns The normalised color, or null when the text is not a hex color yet
 */
function toSwatchColor(value: string | undefined) {
  const parsed = hexColorSchema.safeParse(value ?? "");
  return parsed.success ? parsed.data : null;
}

/**
 * Color field with a native picker swatch, hex text input and random button.
 *
 * @param props.colorFromServer - Initial color; the field re-syncs when it changes
 * @param props.disabled - Disables the swatch along with the hex field
 * @param props.rest - Passed to the hex `Input` (name, error, required, ...)
 */
export const ColorInput = ({
  colorFromServer,
  ...rest
}: {
  colorFromServer?: string;
  [key: string]: any;
}) => {
  const [color, setColor] = useState<string>(() => colorFromServer || "");
  /** The swatch keeps the last valid color while the typed hex is incomplete */
  const [swatchColor, setSwatchColor] = useState<string>(
    () => toSwatchColor(colorFromServer) ?? SWATCH_FALLBACK
  );

  // Re-sync with server-provided color when it changes (e.g. on save revalidation).
  // Uses the "store previous prop in a ref" pattern instead of useEffect to avoid a
  // render flash. See
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const prevColorFromServer = useRef(colorFromServer);
  if (colorFromServer !== prevColorFromServer.current) {
    prevColorFromServer.current = colorFromServer;
    setColor(colorFromServer || "");
    setSwatchColor(toSwatchColor(colorFromServer) ?? SWATCH_FALLBACK);
  }

  const disabled = Boolean(rest.disabled);

  /** Sets the hex field and, when it is a valid color, the swatch */
  const applyColor = (value: string) => {
    setColor(value);
    const next = toSwatchColor(value);
    if (next) {
      setSwatchColor(next);
    }
  };

  const handleColorChange = (e: ChangeEvent<HTMLInputElement>) => {
    applyColor(e.target.value);
  };

  const handleRefresh = () => {
    applyColor(getRandomColor());
  };

  const swatchRef = useRef<HTMLInputElement>(null);
  /** Set when the hex field lost focus to another window (the picker's) */
  const focusLeftWindow = useRef(false);

  const handleHexFocus = (e: FocusEvent<HTMLInputElement>) => {
    rest.onFocus?.(e);
    if (focusLeftWindow.current) {
      // Focus is only coming back from the picker window
      focusLeftWindow.current = false;
      return;
    }
    const picker = swatchRef.current;
    if (disabled || typeof picker?.showPicker !== "function") {
      return;
    }
    try {
      picker.showPicker();
    } catch {
      // The browser refuses without a user gesture (e.g. a programmatic
      // focus); the hex field still works on its own.
    }
  };

  const handleHexBlur = (e: FocusEvent<HTMLInputElement>) => {
    rest.onBlur?.(e);
    // A blur while the document has no focus means another window took it
    focusLeftWindow.current = !document.hasFocus();
  };

  // Use darkened color for icon text to match Badge component
  const iconColor = color ? darkenColor(color, 0.5) : undefined;
  // An empty or half-typed hex leaves the swatch blank rather than showing a
  // color the form would not save.
  const hasColor = toSwatchColor(color) !== null;

  return (
    <div className="flex items-end gap-1">
      <label
        title="Choose a color"
        className={tw(
          "relative flex size-[42px] shrink-0 cursor-pointer rounded-[4px] border border-gray-300 bg-white p-1 shadow",
          "focus-within:border-primary-300 focus-within:ring-2 focus-within:ring-primary-100",
          disabled && "cursor-not-allowed opacity-50"
        )}
      >
        <span
          aria-hidden="true"
          className="size-full rounded-sm ring-1 ring-inset ring-black/10"
          style={{ backgroundColor: hasColor ? swatchColor : undefined }}
        />
        <input
          type="color"
          aria-label="Choose a color"
          ref={swatchRef}
          value={swatchColor}
          onChange={handleColorChange}
          disabled={disabled}
          className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
      </label>
      <Input
        label="Hex Color"
        value={color}
        onChange={handleColorChange}
        className="w-full min-w-[120px] lg:max-w-[120px]"
        {...rest}
        onFocus={handleHexFocus}
        onBlur={handleHexBlur}
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
