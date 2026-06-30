import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { vi } from "vitest";

/**
 * Common Remix hook mocks for testing components that use Remix hooks.
 * These are reusable mocks that can be imported across test files.
 */

// why: provides proper type-safe args for testing loaders with all required React Router 7
// properties. `pattern` and `url` were briefly renamed to `unstable_*` in early 7.16, then
// stabilized back to plain `pattern` / `url` in a later 7.16 patch (which is what's
// resolved by the current lockfile and what CI runs against).
export function createLoaderArgs(
  args: Partial<LoaderFunctionArgs>
): LoaderFunctionArgs {
  const request = args.request || new Request("http://localhost:3000");
  return {
    request,
    params: args.params || {},
    context: args.context || {},
    pattern: args.pattern ?? "*",
    url: args.url ?? new URL(request.url),
  };
}

// why: same as `createLoaderArgs` — `pattern` / `url` stabilized in 7.16's later patch.
export function createActionArgs(
  args: Partial<ActionFunctionArgs>
): ActionFunctionArgs {
  const request =
    args.request || new Request("http://localhost:3000", { method: "POST" });
  return {
    request,
    params: args.params || {},
    context: args.context || {},
    pattern: args.pattern ?? "*",
    url: args.url ?? new URL(request.url),
  };
}

// why: allows testing components that read loader data without running actual loaders
export const createUseLoaderDataMock = () => vi.fn();

// why: allows testing components that use navigation without triggering actual navigation
export const createUseNavigateMock = () => vi.fn();

// why: allows testing form submissions without actual server actions
export const createUseActionDataMock = () => vi.fn();

// why: allows testing components that read fetch results
export const createUseFetcherMock = () => ({
  submit: vi.fn(),
  load: vi.fn(),
  data: undefined,
  state: "idle" as const,
  formData: undefined,
});

// why: allows testing components that read search params without URL manipulation
export const createUseSearchParamsMock = () => {
  const searchParams = new URLSearchParams();
  const setSearchParams = vi.fn();
  return [searchParams, setSearchParams] as const;
};

/**
 * Complete Remix mock setup for components that need multiple hooks
 */
export const createRemixMocks = () => ({
  useLoaderData: createUseLoaderDataMock(),
  useActionData: createUseActionDataMock(),
  useNavigate: createUseNavigateMock(),
  useFetcher: createUseFetcherMock(),
  useSearchParams: createUseSearchParamsMock(),
  Link: ({ to, children, ...rest }: any) => (
    <a {...rest} href={typeof to === "string" ? to : undefined}>
      {children}
    </a>
  ),
});
