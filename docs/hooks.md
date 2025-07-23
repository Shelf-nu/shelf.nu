# Hooks

Shelf comes with a few utility hooks that will make your usage of shelf easier.

> [!NOTE]
> Not all hooks are documented. If you find a hook that is missing in the documentation, feel free to add your contribution by explaining what the hook does, using the same formatting as we typically use.

## useViewportHeight

The `useViewportHeight` hook is a utility hook that provides the current viewport height, excluding the URL bar, in pixels. This is useful for creating full-screen experiences on mobile devices where the URL bar can show and hide dynamically.

The hook returns an object with two properties:

- `vh`: The current viewport height in pixels.
- `isMd`: A boolean indicating whether the viewport width is at least 768px.

### Usage

Here's an example of how to use the `useViewportHeight` hook:

```tsx
import { useViewportHeight } from "./useViewportHeight"; // adjust the path as needed

const MyComponent = () => {
  const { vh, isMd } = useViewportHeight();
  const height = isMd ? vh - 132 : vh - 167;

  return <div style={{ height: `${height}px` }}>{/* Your content here */}</div>;
};
```

## useFetcherWithReset

The `useFetcherWithReset` hook is a utility hook that extends the functionality of the `useFetcher` hook from Remix. It provides a `reset` function that allows you to manually reset the data fetched by the fetcher.

The hook returns an object that includes all properties of the original fetcher, plus a `reset` function and a `data` property of a specified type.

### Usage

Here's an example of how to use the `useFetcherWithReset` hook:

```typescript
import useFetcherWithReset from './useFetcherWithReset'; // adjust the path as needed

const MyComponent = () => {
  const fetcher = useFetcherWithReset<MyDataType>();

  const handleReset = () => {
    fetcher.reset();
  };

  // Use fetcher to fetch data...

  return (
    <div>
      {/* Display fetched data */}
      <button onClick={handleReset}>Reset data</button>
    </div>
  );
};
```

## useBookingStatus

The `useBookingStatus` hook is a utility hook that provides various status flags related to a booking. It's useful for determining the current state of a booking and the presence of certain types of assets within the booking.

The hook returns an object with the following properties:

- `hasAssets`: A boolean indicating whether the booking has any assets.
- `hasUnavailableAssets`: A boolean indicating whether the booking has any assets that are currently unavailable.
- `isDraft`: A boolean indicating whether the booking is in the draft state.
- `isReserved`: A boolean indicating whether the booking is in the reserved state.
- `isOngoing`: A boolean indicating whether the booking is ongoing.
- `isCompleted`: A boolean indicating whether the booking has been completed.
- `isArchived`: A boolean indicating whether the booking has been archived.
- `isOverdue`: A boolean indicating whether the booking is overdue.
- `isCancelled`: A boolean indicating whether the booking has been cancelled.
- `hasCheckedOutAssets`: A boolean indicating whether any assets in the booking have been checked out.
- `hasAlreadyBookedAssets`: A boolean indicating whether any assets in the booking have been booked previously.
- `hasAssetsInCustody`: A boolean indicating whether any assets in the booking are currently in custody.

### Usage

Here's an example of how to use the `useBookingStatus` hook:

```typescript
import useBookingStatus from './useBookingStatus'; // adjust the path as needed

const MyComponent = ({ booking }) => {
  const bookingStatus = useBookingStatus(booking);

  return (
    <div>
      {/* Display booking status */}
      {bookingStatus.isReserved && <div>The booking is reserved.</div>}
    </div>
  );
};
```

## useVideoDevices

The `useVideoDevices` hook manages video device access and permissions for camera-dependent features like QR scanning. It provides device status, error handling, and permission management.

### Returns

- `devices`: Array of available video input devices (`MediaDeviceInfo[]`) or `null`
- `error`: Error object if device access fails or `null`
- `loading`: Boolean indicating if device enumeration is in progress
- `requestPermissions`: Function to request device access
- `DevicesPermissionComponent`: React component for rendering permission/error UI states

### Usage

````typescript
const QRScanner = () => {
 const { devices, DevicesPermissionComponent } = useVideoDevices();

 return (
   <div>
     {devices ? (
       <Scanner videoMediaDevices={devices} />
     ) : (
       <DevicesPermissionComponent />
     )}
   </div>
 );
};

## `useDisabled`

The `useDisabled` hook is used to determine if a button should be disabled during navigation. By default, it operates with the navigation state, but it can optionally accept a fetcher to use as the state.

**Usage:**

```typescript
/** Without fetcher, using default navigation */
const isDisabled = useDisabled();

/** Without fetcher */
const isDisabled = useDisabled(fetcher);
````

**Parameters:**

- `fetcher` (optional): An object that contains the state to be used. If not provided, the navigation state will be used.

**Returns:**

- `boolean`: Returns `true` if the form is processing and the button should be disabled, otherwise `false`.

**Example:**

```typescript
import { useDisabled } from './path/to/hooks';

const MyComponent = () => {
  const fetcher = useFetcher();
  const isDisabled = useDisabled(fetcher);

  return (
    <button disabled={isDisabled}>
      Submit
    </button>
  );
};
```

**Dependencies:**

- `useNavigation`: A hook that provides the current navigation state.
- `isFormProcessing`: A function that checks if the form is currently processing based on the state.

## useUserRoleHelper

The `useUserRoleHelper` hook is helps you to always know the roles of the current user and also returns some helper boolean values to make it easier to check for specific roles.

The useUserRoleHelper function returns an object(roles) and helper boolean attributes:

- `roles`: enum that provides role of the current user
- `isAdministrator`: A boolean value indicating whether the user has the 'ADMIN' role.
- `isOwner`: A boolean value indicating whether the user has the OWNER role.
- `isAdministratorOrOwner`: A boolean value indicating whether the user has either the 'ADMIN' or 'OWNER'role.
- `isSelfService`: A boolean value indicating whether the user has the 'SELF_SERVICE' role.
- `isBase`: A boolean value indicating whether the user has the 'BASE' role.
- `isBaseOrSelfService`: A boolean value indicating whether the user has either the BASE or 'SELF_SERVICE' role.

**Usage:**
The "New Asset" button is rendered only if isAdministratorOrOwner is true.

```typescript
import React from 'react';
import { useUserRoleHelper } from '~/hooks/user-user-role-helper';

export default function AssetIndexPage() {
  const { isAdministratorOrOwner } = useUserRoleHelper();

  return (
    <div>
      <header>
        {isAdministratorOrOwner && (
          <button>
            New Asset
          </button>
        )}
      </header>
    </div>
  );
}
```

**Dependencies:**

- `useRouteLoaderData`: hook from `@remix-run/react` that returns the loader data for a given route by ID.

## `useUserData`

The `useUserData` hook is used to access the current user's data from within any component in the application, particularly those nested under the `_layout` route.

**Overview**

This hook simplifies the process of retrieving user data that is loaded in the `_layout` route. It uses the `useRouteLoaderData` hook from Remix to access the loader data, making it easy to get user information without prop drilling.

**Returns**

- `user`: The user data object from the `_layout` route loader. This typically includes properties like `email` and possibly other user-related information.

**Usage:**

Here's an example of how to use the `useUserData` hook in a component:

```typescript
import React from 'react';
import { useUserData } from '~/hooks/use-user-data';

export const RequestDeleteUser = () => {
  const user = useUserData();

  return (
    <form>
      {/* Other form elements */}
      <input type="hidden" name="email" value={user?.email} />
      {/* Rest of the component */}
    </form>
  );
}
```

In this example, the `useUserData` hook is used to retrieve the current user's email address, which is then used in a hidden form field.

## Dependencies

- `useRouteLoaderData`: A hook from `@remix-run/react` that returns the loader data for a given route by ID.
- `loader` type from `~/routes/_layout+/_layout`: Used to type the loader data.

## useTableIsOverflowing

**Overview**

The `useTableIsOverflowing` hook is used to handle the table's right-side scroll fade effect. It checks whether the table is overflowing and determines if the fade effect should be applied.

**Returns:**

- `containerRef`: A reference to the table container element.

- `isOverflowing`: A boolean indicating whether the table is overflowing and has not reached the end.

**Usage:**

```typescript
import React from "react";
import { useTableIsOverflowing } from "~/hooks/use-table-overflow";
import { tw } from "~/utils/tw";

export function Table({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { containerRef, isOverflowing } = useTableIsOverflowing();

  return (
    <div className={`relative ${isOverflowing ? "overflowing" : ""}`}>
      <div className="fixed-gradient"></div>
      <div
        ref={containerRef}
        className="scrollbar-top scrollbar-always-visible"
      >
        <table className={tw("w-full table-auto border-collapse", className)}>
          {children}
        </table>
      </div>
    </div>
  );
}
```

In this example hook detects if the table content exceeds the container's width. When it does, isOverflowing becomes true, adding the overflowing class to the outer div. This class can trigger visual indicators like gradients to show users there's more content to scroll through.

## useTheme

**Overview**

The `useTheme` hook is a client-side theme management hook that provides real-time theme detection and updates. Unlike server-side theme detection, this hook immediately reacts to theme changes and provides the current theme state for components that need to adapt their behavior based on the active theme.

**Features**

- Detects initial theme from localStorage or system preference
- Listens for theme changes via localStorage (cross-tab synchronization)
- Monitors system preference changes when no manual theme is set
- Watches for DOM class changes for immediate updates
- Provides reliable client-side theme state

**Returns:**

- `theme`: A string value of either `"light"` or `"dark"` representing the current active theme.

**Usage:**

```typescript
import React from "react";
import { useTheme } from "~/hooks/use-theme";

export function ThemeAwareComponent() {
  const theme = useTheme();

  return (
    <div>
      <p>Current theme: {theme}</p>
      {theme === "dark" ? (
        <DarkModeSpecificComponent />
      ) : (
        <LightModeSpecificComponent />
      )}
    </div>
  );
}
```

**Implementation Details:**

The hook handles multiple theme change scenarios:

- **Initial Load**: Checks localStorage first, falls back to system preference
- **Storage Changes**: Responds to theme changes from other tabs/windows
- **System Changes**: Updates when system preference changes (only if no manual theme is set)
- **DOM Changes**: Watches for immediate class changes on the HTML element

This ensures that components using this hook stay synchronized with the current theme state across all possible theme change scenarios.

## usePlaceholderImage

**Overview**

The `usePlaceholderImage` hook provides theme-aware placeholder image URLs for assets. It automatically returns the appropriate placeholder image based on the current theme, ensuring that placeholder images blend well with both light and dark mode interfaces.

**Returns:**

- `string`: The URL path to the appropriate placeholder image for the current theme.
  - Light theme: `/static/images/asset-placeholder.jpg`
  - Dark theme: `/static/images/asset-placeholder-dark.jpeg`

**Usage:**

```typescript
import React from "react";
import { usePlaceholderImage } from "~/hooks/use-placeholder-image";

export function AssetImage({ src, alt }: { src?: string; alt: string }) {
  const placeholderSrc = usePlaceholderImage();

  return (
    <img
      src={src || placeholderSrc}
      alt={alt}
      onError={(e) => {
        e.currentTarget.src = placeholderSrc;
      }}
    />
  );
}
```

**Dependencies:**

- `useTheme`: Used internally to determine the current theme and select the appropriate placeholder image.

This hook is particularly useful for:

- Asset images that may fail to load
- Default images for new assets
- Consistent placeholder appearance across theme changes
- Maintaining visual consistency in image galleries and asset lists
