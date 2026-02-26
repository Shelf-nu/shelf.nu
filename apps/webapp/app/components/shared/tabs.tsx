import * as React from "react";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { tw } from "~/utils/tw";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  ElementRef<typeof TabsPrimitive.List>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={tw(
        "inline-flex items-center justify-center rounded-md bg-slate-100 p-1",
        className
      )}
      {...props}
    />
  );
});

const TabsTrigger = React.forwardRef<
  ElementRef<typeof TabsPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      className={tw(
        "inline-flex min-w-[100px] items-center justify-center rounded-[0.185rem] px-2.5 py-1  text-text-sm font-medium text-color-700 transition-all  data-[state=active]:bg-surface data-[state=active]:text-slate-900 data-[state=active]:shadow-sm disabled:pointer-events-none disabled:opacity-50 ",
        className
      )}
      {...props}
      ref={ref}
    />
  );
});

const TabsContent = React.forwardRef<
  ElementRef<typeof TabsPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      className={tw("mt-2 rounded", className)}
      {...props}
      ref={ref}
    />
  );
});

export { Tabs, TabsList, TabsTrigger, TabsContent };
