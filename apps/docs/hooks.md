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

## useRoleAccess

`useRoleAccess()` returns the signed-in member's `RoleAccess` for the current
workspace, as the server resolved it in the `_layout` loader: the effective
role, whether they see and write every booking, whether they see every
custodian and whom they may assign custody to, whether they see every audit,
and whether they own the workspace. Before the layout data loads it returns
Base access with every toggle off, so gates stay closed.

```tsx
import { useRoleAccess } from "~/hooks/use-role-access";

export function AssignCustodyButton() {
  const access = useRoleAccess();
  if (access.custody.assign === "none") return null;
  return (
    <Button type="button">
      {access.custody.assign === "self" ? "Take custody" : "Assign custody"}
    </Button>
  );
}
```

## useOrganizationRoles

`useOrganizationRoles()` returns every role the member holds in the current
workspace. Use it only for permission-matrix checks, which union grants across
held roles:

```tsx
const roles = useOrganizationRoles();
const canCreateAsset = userHasPermission({
  roles,
  entity: PermissionEntity.asset,
  action: PermissionAction.create,
});
```

Never compare the roles yourself. See [Roles & Permissions](./roles-and-permissions.md).

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

- `useRouteLoaderData`: A hook from `react-router` that returns the loader data for a given route by ID.
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
  children: ReactNode;
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
