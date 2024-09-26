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

```typescriptreact
import { useViewportHeight } from './useViewportHeight'; // adjust the path as needed

const MyComponent = () => {
  const { vh, isMd } = useViewportHeight();
  const height = isMd ? vh - 132 : vh - 167;

  return (
    <div style={{ height: `${height}px` }}>
      {/* Your content here */}
    </div>
  );
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

## useQrScanner

The `useQrScanner` hook is a utility hook that retrieves available video input devices for use in applications that require video input, such as QR code scanners. This hook helps manage the state of video devices, making it easier to implement features that depend on accessing the user's camera.

The hook returns an object with one property:
`videoMediaDevices`: An array of MediaDeviceInfo objects representing the available video input devices.

### Usage

Here's an example of how to use the `useQrScanner` hook:

```typescript
import { useQrScanner } from './useQrScanner';

const QRScannerComponent = () => {
  const { videoMediaDevices } = useQrScanner();
  const { vh, isMd } = useViewportHeight();
  const height = isMd ? vh - 132 : vh - 167;

  return (
    <div style={{ height: `${height}px` }}>
      {videoMediaDevices && videoMediaDevices.length > 0 ? (
        <ZXingScanner videoMediaDevices={videoMediaDevices} />
      ) : (
        <div className="mt-4 flex flex-col items-center justify-center">
          <Spinner /> Waiting for permission to access the camera.
        </div>
      )}
    </div>
  );
};
```

## `useDisabled`

The `useDisabled` hook is used to determine if a button should be disabled during navigation. By default, it operates with the navigation state, but it can optionally accept a fetcher to use as the state.

**Usage:**

```typescript
/** Without fetcher, using default navigation */
const isDisabled = useDisabled();

/** Without fetcher */
const isDisabled = useDisabled(fetcher);
```

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
