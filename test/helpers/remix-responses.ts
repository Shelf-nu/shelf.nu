/**
 * Test helper functions for mocking Remix/React Router responses in React Router v7 single fetch mode
 */

import { vi } from "vitest";

/**
 * Mock implementation of Remix's data() function for React Router v7 single fetch
 * Returns a Response object matching the actual runtime behavior
 *
 * @example
 * vi.mock("@remix-run/node", async () => {
 *   const actual = await vi.importActual("@remix-run/node");
 *   return {
 *     ...actual,
 *     data: createDataMock(),
 *   };
 * });
 */
export function createDataMock() {
  return vi.fn((data: unknown, init?: ResponseInit) => {
    return new Response(JSON.stringify(data), {
      status: init?.status || 200,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
  });
}

/**
 * Helper to extract status code from Response returned by mocked data()
 *
 * @example
 * const response = await action({ context, request, params });
 * expect(getResponseStatus(response)).toBe(200);
 */
export function getResponseStatus(response: unknown): number {
  if (response instanceof Response) {
    return response.status;
  }
  throw new Error(
    `Expected Response but got: ${typeof response}. Did you forget to mock @remix-run/node data()?`
  );
}

/**
 * Helper to extract JSON data from Response returned by mocked data()
 *
 * @example
 * const response = await loader({ context, request, params });
 * const data = await getResponseData(response);
 * expect(data).toEqual({ error: null, items: [...] });
 */
export async function getResponseData<T = unknown>(
  response: unknown
): Promise<T> {
  if (response instanceof Response) {
    return response.json();
  }
  throw new Error(
    `Expected Response but got: ${typeof response}. Did you forget to mock @remix-run/node data()?`
  );
}
