"use client";
import * as React from "react";
import { OTPInput, OTPInputContext } from "input-otp";
import { Minus } from "lucide-react";
import { tw } from "~/utils/tw";
import { InnerLabel } from "./inner-label";

const InputOTP = React.forwardRef<
  React.ElementRef<typeof OTPInput>,
  React.ComponentPropsWithoutRef<typeof OTPInput>
>(({ className, containerClassName, ...props }, ref) => (
  <OTPInput
    ref={ref}
    containerClassName={tw(
      "flex items-center gap-2 has-[:disabled]:opacity-50",
      containerClassName
    )}
    className={tw("disabled:cursor-not-allowed", className)}
    {...props}
  />
));
InputOTP.displayName = "InputOTP";

const InputOTPGroup = React.forwardRef<
  React.ElementRef<"div">,
  React.ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => (
  <div ref={ref} className={tw("flex items-center", className)} {...props} />
));
InputOTPGroup.displayName = "InputOTPGroup";

const InputOTPSlot = React.forwardRef<
  React.ElementRef<"div">,
  React.ComponentPropsWithoutRef<"div"> & { index: number }
>(({ index, className, ...props }, ref) => {
  const inputOTPContext = React.useContext(OTPInputContext);
  const { char, hasFakeCaret, isActive } = inputOTPContext.slots[index];

  return (
    <div
      ref={ref}
      className={tw(
        "border-input relative flex h-[42px] w-full items-center justify-center border-y border-r border-gray-300 text-[16px]  transition-all first:rounded-l-[4px] first:border-l last:rounded-r-[4px]",
        isActive && "z-10 ring-1 ring-primary-500",
        className
      )}
      {...props}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-4 w-[2px] animate-caret-blink bg-gray-500 duration-1000" />
        </div>
      )}
    </div>
  );
});
InputOTPSlot.displayName = "InputOTPSlot";

const InputOTPSeparator = React.forwardRef<
  React.ElementRef<"div">,
  React.ComponentPropsWithoutRef<"div">
>(({ ...props }, ref) => (
  <div ref={ref} role="separator" {...props}>
    <Minus />
  </div>
));
InputOTPSeparator.displayName = "InputOTPSeparator";

function ShelfOTP({ error }: { error?: string }) {
  return (
    <div>
      <label className={tw("relative flex flex-col")} htmlFor={"otp"}>
        <InnerLabel required>Code</InnerLabel>
        <InputOTP maxLength={6} name="otp" required>
          <InputOTPGroup className="w-full">
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
            <InputOTPSlot index={3} />
            <InputOTPSlot index={4} />
            <InputOTPSlot index={5} />
          </InputOTPGroup>
        </InputOTP>
      </label>
      <div className="!mt-1  text-sm text-error-500">{error}</div>
    </div>
  );
}

export { ShelfOTP, InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator };
