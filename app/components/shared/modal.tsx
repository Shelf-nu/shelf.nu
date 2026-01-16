import * as React from "react";
import type {
  ComponentPropsWithoutRef,
  ElementRef,
  HTMLAttributes,
} from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { tw } from "~/utils/tw";

const AlertDialog = AlertDialogPrimitive.Root;

const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

const AlertDialogPortal = ({
  children,
  ...props
}: AlertDialogPrimitive.AlertDialogPortalProps) => (
  <AlertDialogPrimitive.Portal {...props}>
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {children}
    </div>
  </AlertDialogPrimitive.Portal>
);
AlertDialogPortal.displayName = AlertDialogPrimitive.Portal.displayName;

const AlertDialogOverlay = React.forwardRef<
  ElementRef<typeof AlertDialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(function AlertDialogOverlay({ className, ...props }, ref) {
  return (
    <AlertDialogPrimitive.Overlay
      className={tw(
        "fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm transition-opacity animate-in fade-in",
        className
      )}
      {...props}
      ref={ref}
    />
  );
});

type ALertDialogContentProps = ComponentPropsWithoutRef<
  typeof AlertDialogPrimitive.Content
> & {
  portalProps?: AlertDialogPrimitive.AlertDialogPortalProps;
};

const AlertDialogContent = React.forwardRef<
  ElementRef<typeof AlertDialogPrimitive.Content>,
  ALertDialogContentProps
>(function AlertDialogContent({ className, portalProps, ...props }, ref) {
  return (
    <AlertDialogPortal {...portalProps}>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        ref={ref}
        className={tw(
          "fixed z-[100] flex max-h-[90vh] w-full max-w-md scale-100 flex-col gap-4 rounded bg-white p-6 opacity-100 animate-in fade-in-90 slide-in-from-bottom-10 sm:zoom-in-90 sm:slide-in-from-bottom-0 md:w-full",
          className
        )}
        {...props}
      />
    </AlertDialogPortal>
  );
});

const AlertDialogHeader = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={tw(
      "flex flex-col space-y-2 text-center sm:text-left",
      className
    )}
    {...props}
  />
);
AlertDialogHeader.displayName = "AlertDialogHeader";

const AlertDialogFooter = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={tw(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
);
AlertDialogFooter.displayName = "AlertDialogFooter";

const AlertDialogTitle = React.forwardRef<
  ElementRef<typeof AlertDialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(function AlertDialogTitle({ className, ...props }, ref) {
  return (
    <AlertDialogPrimitive.Title
      ref={ref}
      className={tw("text-lg font-semibold text-gray-900", className)}
      {...props}
    />
  );
});

const AlertDialogDescription = React.forwardRef<
  ElementRef<typeof AlertDialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(function AlertDialogDescription({ className, ...props }, ref) {
  return (
    <AlertDialogPrimitive.Description
      ref={ref}
      className={tw("text-sm text-gray-500", className)}
      {...props}
    />
  );
});

const AlertDialogAction = React.forwardRef<
  ElementRef<typeof AlertDialogPrimitive.Action>,
  ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
>(function AlertDialogAction({ className, ...props }, ref) {
  return (
    <AlertDialogPrimitive.Action
      ref={ref}
      className={tw(className)}
      {...props}
    />
  );
});

const AlertDialogCancel = React.forwardRef<
  ElementRef<typeof AlertDialogPrimitive.Cancel>,
  ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(function AlertDialogCancel({ className, ...props }, ref) {
  return (
    <AlertDialogPrimitive.Cancel
      ref={ref}
      className={tw(className)}
      {...props}
    />
  );
});

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
