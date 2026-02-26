/**
 * Test helper functions for asserting response types in React Router v7 single fetch mode
 */

/**
 * Type guard to assert that a response is a DataWithResponseInit object
 * Used when testing actions that return data() with response init options
 *
 * @example
 * const response = await action({ context, request, params });
 * assertIsDataWithResponseInit(response);
 * expect(response.init?.status).toBe(500);
 */
export function assertIsDataWithResponseInit(
  response: unknown
): asserts response is {
  init: ResponseInit | null;
  data: unknown;
  type: string;
} {
  if (
    typeof response === "object" &&
    response != null &&
    "type" in response &&
    "data" in response &&
    "init" in response &&
    (response as { type: string }).type === "DataWithResponseInit"
  ) {
    return;
  }
  throw new Error(
    `Expected DataWithResponseInit but got: ${JSON.stringify(response)}`
  );
}
