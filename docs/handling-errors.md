# Handling Errors

In order to have a good user experience and proper error handling with meaningful logs, we need to follow some guidelines.

> [!NOTE]
> The best way to learn how to handle errors is to look at the existing code and see how it's done.

## Routes with a view

- ✅ Always use a `try/catch` block to catch errors and send a proper error response.
- Everything that can throw an error should be inside the `try` block.
- Everything thrown error will be caught and handled in the `catch` block.

### Loader

- ✅ Always return a `json(payload({...}))` response in the `try` block.
- ✅ Always throw a `json(error({...}))` response in the `catch` block.

```ts
export function loader(){
	try {
		// Do something
		return json(payload({name: 'John'}));
	} catch (cause) {
		const reason = makeShelfError(cause);
		throw json(error(reason));
	}
}

export default Route() {
	const loaderData = useLoaderData<typeof loader>();
	//      ^ {name: string}

}
```

### Action

- ✅ Always return a `json(payload({...}))` response in the `try` block.
- ✅ Always return a `json(error({...}))` response in the `catch` block.

Now, in the route component using `useActionData`, you can access the returned data or error.

You have to handle the error first before accessing the data.

```ts
export function action(){
	try {
		// Do something
		return json(payload({name: 'John'}));
	} catch (cause) {
		const reason = makeShelfError(cause);
		return json(error(reason));
	}
}

export default Route() {
	const actionData = useActionData<typeof action>();
	//      ^ {error: {...} | null} | {name: string, error: null}
	const data = actionData && !actionData.error ? actionData.data : null;
	//      ^ {name: string, error: null} | null
	const error = actionData?.error;
	//      ^ {...} | undefined
}
```

## Resources routes

- ✅ Always use a `try/catch` block to catch errors and send a proper error response.
- Everything that can throw an error should be inside the `try` block.
- Everything thrown error will be caught and handled in the `catch` block.

### Loader

- ✅ Always return a `json(payload({...}))` response in the `try` block.
- ✅ Always return a `json(error({...}))` response in the `catch` block.

### Action

- ✅ Always return a `json(payload({...}))` response in the `try` block.
- ✅ Always return a `json(error({...}))` response in the `catch` block.

## Services

> [!IMPORTANT]
>
> Only throw `ShelfError`, never a `json` or `Response`

- ✅ Always use a `try/catch` block to catch errors and send a proper `ShelfError`.
- Everything that can throw an error should be inside the `try` block.
- Everything thrown error will be caught and handled in the `catch` block.

## DB queries

- ✅ Always try to use a `try/catch` block, in a dedicated function, to catch errors and send a proper `ShelfError`.
- If you don't want to extract your db query in a function, use `.catch()` to handle any error.

```ts
async function loader({ params }: LoaderFunctionArgs) {
  try {
    const user = await getUser(params.id); // This function handles its own errors
    const userMainOrg = db.organization
      .findFirst({
        where: {
          orgId: user.mainOrgId,
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message:
            "An error occurred while fetching the user main organization",
          additionalData: {
            params,
            user,
          },
          label: "Organization",
        });
      }); // Now we have a better understanding of the error happening here

    return json(payload({ user, userMainOrg }));
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason));
  }
}
```

## Utils

### `ShelfError` class

> [Source](/app/utils/error.ts)

This class is used to create a custom error object that can be used to throw errors in the application.

> [!IMPORTANT]
> If you don't want an error to be captured by Sentry, you can set the `shouldBeCaptured` property to `false`.

```ts
throw new ShelfError({
  cause,
  message: "An error occurred while fetching the user main organization",
  additionalData: {
    params,
    user,
  },
  label: "Organization",
  shouldBeCaptured: false, // This error won't be captured by Sentry but will still be logged in the console
});
```

### `payload()` & `error()` functions

> [Source](/app/utils/http.server.ts)

These functions are used to build the payload response returned by `json()`. The `payload()` function is used to send a successful response, while the `error()` function is used to send an error response.

### `makeShelfError()` function

> [Source](/app/utils/error.ts)

This function is used to create a `ShelfError` object from a caught error. It is used to standardize the error object and make sure that the error is properly formatted before being sent to the client.

It pairs with the [`error()`](/app/utils/http.server.ts).

It can take an optional `additionalData` parameter to add more context to the error.

```ts
...
} catch (cause) {
	const reason = makeShelfError(cause, {userId});
	throw json(error(reason));
}

```

### Misc

#### `parseData()` function

> [Source](/app/utils/http.server.ts)
>
> ✅ Use it in a `try/catch` block

This function is used to parse the data coming from a `FormData`, `URLSearchParams` or an object and validate it against a Zod schema.

It throws a `ShelfError` (`badRequest()`) if the data is invalid.

> [!IMPORTANT]
> By default, errors are not captured by Sentry. If you want to capture the error, you can set the `shouldBeCaptured` property to `true`.

#### `getParams()` function

> [Source](/app/utils/http.server.ts)
>
> ❌ Don't use it in a `try/catch` block

This function is a superset of the `parseData()` function. It is used to parse the `params` object and validate it against a Zod schema.

It directly throw a `json` response if the `params` are invalid.

#### `getValidationErrors()` function

> [Source](/app/utils/http.ts)

This function is used to get the `validationErrors` from the `error.additionalData` object returned by the `error()` function.
It pairs well with Forms validation, when you want to display a specific error message for a given field.

```ts
const nameError = getValidationErrors<typeof MySchema>(actionData?.error).name
  ?.message;
```

### Eslint rules involved

#### @typescript-eslint/no-floating-promises

> [Link](https://typescript-eslint.io/rules/no-floating-promises/)

This rules will require you to handle floating promises (promises that are not awaited or returned).

This mostly to prevent calling an async function that doesn't internally handle its own errors. This could result in a server crash.

> [!TIP]
> If you know what you are doing (like calling a `sendEmail` function that handles its own errors in a catch block), you can silence this error with calling the function with `void`. (Use with caution!)
>
> ```ts
> void sendEmail();
> ```
