# Split `Tailwind` classes with `tw` from `"~/utils/tw-classes"`

Date: 15-09-2022

Status: accepted

## Context

Having a lot of Tailwind classes can be hard to manage

## Decision

> `tw` handles removing deduplication of similar classes and splitting them.
>
> It gives priority to the last override.

### Use `tw` to wrap Tailwind classes when more than 5 classes

https://github.com/dcastil/tailwind-merge

```js
<div className={tw("... bg-red-100 font-bold")} />
```

### Split classes across multiple lines and group similar classes together

- positioning
- size
- content
- border
- color

```js
<div
  className={tw(
    "absolute -top-1 -right-0.5 m-2", //positioning
    "h-4 w-4", //size
    "flex items-center justify-center p-2", //content
    "rounded-full focus:outline-none", //border
    "bg-pink-500 text-white shadow-sm shadow-black" //color
    // You can add comments to your styling code.
  )}
/>
```

### Use array to group variants specifications

```js
<button
  {...buttonProps}
  className={tw(
    "inline-flex items-center justify-center px-3 py-2", //default style
    "min-w-0",
    "inline-flex items-center justify-center",
    "truncate bg-white text-xs font-bold focus:outline-none",
    variant === "cta" && [
      // variant
      "py-2 px-3",
      "text-indigo-500 lg:text-lg",
      "rounded-lg border-2 border-gray-100",
    ],
    variant === "notification" && [
      // variant
      "py-[6px] px-3",
      "text-gray-700",
      "rounded-md border-2 border-gray-100",
    ],
    variant === "icon" && ["p-1", "rounded-lg border-2 border-gray-100"], // variant
    variant === "text" && ["text-gray-700"], // variant
    buttonProps.className // on demand style override
  )}
/>
```

## Consequences
