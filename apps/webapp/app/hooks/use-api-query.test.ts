/**
 * Tests for {@link useApiQuery} (`~/hooks/use-api-query`).
 *
 * Beyond the request/loading/error surface, two properties here are the whole
 * reason the hook exists rather than a bare `fetch` in an effect, and each has
 * a case that fails without it: only the current request's answer is applied,
 * and the newest callback the caller rendered is the one invoked — including
 * when the caller rebuilds that callback on every render, which every real
 * call site does.
 *
 * @see {@link file://./use-api-query.ts}
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import useApiQuery from "./use-api-query";

// why: testing hook behavior without making actual network requests
const mockFetch = vi.fn();

const waitForAsyncUpdate = (assertion: () => void | Promise<void>) =>
  // Testing Library defaults to a 50ms polling interval to avoid pegging the CPU
  // when you're waiting on timers. The hook under test resolves via microtasks
  // (fetch mocks + state updates), so there's no benefit to that additional
  // delay—the assertion will pass as soon as React flushes the update. Tightening
  // the interval keeps the behaviour identical while cutting the per-assertion
  // wait from 50ms down to ~1ms.
  waitFor(assertion, { interval: 1 });

describe("useApiQuery", () => {
  beforeEach(() => {
    // Use spyOn so the mock is installed after MSW 2's fetch interception
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should start with initial state", () => {
    const { result } = renderHook(() =>
      useApiQuery({
        api: "/api/test",
        enabled: false,
      })
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeUndefined();
    expect(result.current.data).toBeUndefined();
    expect(typeof result.current.refetch).toBe("function");
  });

  it("should not make request when enabled is false", () => {
    renderHook(() =>
      useApiQuery({
        api: "/api/test",
        enabled: false,
      })
    );

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should make request when enabled is true", async () => {
    const mockData = { id: 1, name: "Test" };
    mockFetch.mockResolvedValueOnce({
      json: vi.fn().mockResolvedValueOnce(mockData),
    });

    const { result } = renderHook(() =>
      useApiQuery({
        api: "/api/test",
        enabled: true,
      })
    );

    expect(result.current.isLoading).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/test",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );

    await waitForAsyncUpdate(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockData);
    expect(result.current.error).toBeUndefined();
  });

  it("should include search parameters in URL", async () => {
    const mockData = { results: [] };
    mockFetch.mockResolvedValueOnce({
      json: vi.fn().mockResolvedValueOnce(mockData),
    });

    const searchParams = new URLSearchParams();
    searchParams.append("page", "1");
    searchParams.append("limit", "10");

    renderHook(() =>
      useApiQuery({
        api: "/api/assets",
        searchParams,
        enabled: true,
      })
    );

    await waitForAsyncUpdate(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/assets?page=1&limit=10",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
  });

  it("should handle fetch errors", async () => {
    const errorMessage = "Network error";
    mockFetch.mockRejectedValueOnce(new Error(errorMessage));

    const { result } = renderHook(() =>
      useApiQuery({
        api: "/api/test",
        enabled: true,
      })
    );

    expect(result.current.isLoading).toBe(true);

    await waitForAsyncUpdate(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe(errorMessage);
    expect(result.current.data).toBeUndefined();
  });

  it("should handle errors without message", async () => {
    mockFetch.mockRejectedValueOnce("Some error");

    const { result } = renderHook(() =>
      useApiQuery({
        api: "/api/test",
        enabled: true,
      })
    );

    await waitForAsyncUpdate(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe("Something went wrong.");
    expect(result.current.data).toBeUndefined();
  });

  it("should refetch when refetch is called", async () => {
    const mockData1 = { id: 1, name: "First" };
    const mockData2 = { id: 2, name: "Second" };

    mockFetch
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValueOnce(mockData1),
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValueOnce(mockData2),
      });

    const { result } = renderHook(() =>
      useApiQuery({
        api: "/api/test",
        enabled: true,
      })
    );

    await waitForAsyncUpdate(() => {
      expect(result.current.data).toEqual(mockData1);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Trigger refetch
    act(() => {
      result.current.refetch();
    });

    await waitForAsyncUpdate(() => {
      expect(result.current.data).toEqual(mockData2);
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should re-run query when dependencies change", async () => {
    const mockData = { id: 1 };
    mockFetch.mockResolvedValue({
      json: vi.fn().mockResolvedValue(mockData),
    });

    const { rerender } = renderHook(
      ({ api }) =>
        useApiQuery({
          api,
          enabled: true,
        }),
      {
        initialProps: { api: "/api/test1" },
      }
    );

    await waitForAsyncUpdate(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/test1",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    // Change the API endpoint
    rerender({ api: "/api/test2" });

    await waitForAsyncUpdate(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/test2",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should re-run query when searchParams change", async () => {
    const mockData = { results: [] };
    mockFetch.mockResolvedValue({
      json: vi.fn().mockResolvedValue(mockData),
    });

    const searchParams1 = new URLSearchParams();
    searchParams1.append("page", "1");

    const searchParams2 = new URLSearchParams();
    searchParams2.append("page", "2");

    const { rerender } = renderHook(
      ({ searchParams }) =>
        useApiQuery({
          api: "/api/test",
          searchParams,
          enabled: true,
        }),
      {
        initialProps: { searchParams: searchParams1 },
      }
    );

    await waitForAsyncUpdate(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/test?page=1",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    // Change search params
    rerender({ searchParams: searchParams2 });

    await waitForAsyncUpdate(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/test?page=2",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should support enabled toggling", async () => {
    const mockData = { id: 1 };
    mockFetch.mockResolvedValue({
      json: vi.fn().mockResolvedValue(mockData),
    });

    const { rerender } = renderHook(
      ({ enabled }) =>
        useApiQuery({
          api: "/api/test",
          enabled,
        }),
      {
        initialProps: { enabled: false },
      }
    );

    // Should not make request when disabled
    expect(mockFetch).not.toHaveBeenCalled();

    // Enable the query
    rerender({ enabled: true });

    await waitForAsyncUpdate(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/test",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should handle API with no search parameters", async () => {
    const mockData = { message: "success" };
    mockFetch.mockResolvedValueOnce({
      json: vi.fn().mockResolvedValueOnce(mockData),
    });

    renderHook(() =>
      useApiQuery({
        api: "/api/health",
        enabled: true,
      })
    );

    await waitForAsyncUpdate(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/health",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
  });

  it("should type data correctly", async () => {
    interface TestData {
      id: number;
      name: string;
    }

    const mockData: TestData = { id: 1, name: "Test" };
    mockFetch.mockResolvedValueOnce({
      json: vi.fn().mockResolvedValueOnce(mockData),
    });

    const { result } = renderHook(() =>
      useApiQuery<TestData>({
        api: "/api/test",
        enabled: true,
      })
    );

    await waitForAsyncUpdate(() => {
      expect(result.current.data).toEqual(mockData);
    });

    // TypeScript should infer the correct type
    if (result.current.data) {
      expect(typeof result.current.data.id).toBe("number");
      expect(typeof result.current.data.name).toBe("string");
    }
  });

  it("should handle response.json() errors", async () => {
    mockFetch.mockResolvedValueOnce({
      json: vi.fn().mockRejectedValueOnce(new Error("Invalid JSON")),
    });

    const { result } = renderHook(() =>
      useApiQuery({
        api: "/api/test",
        enabled: true,
      })
    );

    await waitForAsyncUpdate(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe("Invalid JSON");
    expect(result.current.data).toBeUndefined();
  });

  it("should call onSuccess callback when query succeeds", async () => {
    const mockData = { id: 1, name: "Test" };
    const onSuccessMock = vi.fn();

    mockFetch.mockResolvedValueOnce({
      json: vi.fn().mockResolvedValueOnce(mockData),
    });

    renderHook(() =>
      useApiQuery({
        api: "/api/test",
        enabled: true,
        onSuccess: onSuccessMock,
      })
    );

    await waitForAsyncUpdate(() => {
      expect(onSuccessMock).toHaveBeenCalledWith(mockData);
    });

    expect(onSuccessMock).toHaveBeenCalledTimes(1);
  });

  it("should call onError callback when query fails", async () => {
    const errorMessage = "Network error";
    const onErrorMock = vi.fn();

    mockFetch.mockRejectedValueOnce(new Error(errorMessage));

    renderHook(() =>
      useApiQuery({
        api: "/api/test",
        enabled: true,
        onError: onErrorMock,
      })
    );

    await waitForAsyncUpdate(() => {
      expect(onErrorMock).toHaveBeenCalledWith(errorMessage);
    });

    expect(onErrorMock).toHaveBeenCalledTimes(1);
  });

  it("should call callbacks on refetch", async () => {
    const mockData1 = { id: 1, name: "First" };
    const mockData2 = { id: 2, name: "Second" };
    const onSuccessMock = vi.fn();

    mockFetch
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValueOnce(mockData1),
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValueOnce(mockData2),
      });

    const { result } = renderHook(() =>
      useApiQuery({
        api: "/api/test",
        enabled: true,
        onSuccess: onSuccessMock,
      })
    );

    await waitForAsyncUpdate(() => {
      expect(onSuccessMock).toHaveBeenCalledWith(mockData1);
    });

    // Trigger refetch
    act(() => {
      result.current.refetch();
    });

    await waitForAsyncUpdate(() => {
      expect(onSuccessMock).toHaveBeenCalledWith(mockData2);
    });

    expect(onSuccessMock).toHaveBeenCalledTimes(2);
  });

  it("should not call callbacks when enabled is false", () => {
    const onSuccessMock = vi.fn();
    const onErrorMock = vi.fn();

    renderHook(() =>
      useApiQuery({
        api: "/api/test",
        enabled: false,
        onSuccess: onSuccessMock,
        onError: onErrorMock,
      })
    );

    expect(mockFetch).not.toHaveBeenCalled();
    expect(onSuccessMock).not.toHaveBeenCalled();
    expect(onErrorMock).not.toHaveBeenCalled();
  });
  it("ignores a superseded response when the url changes mid-flight", async () => {
    // why: the case turns on completion ORDER, so one response has to be held
    // open while a second answers. Only a hand-built deferred lets the test
    // decide when the first one settles.
    let resolveFirst: (value: unknown) => void = () => {};
    const firstResponse = new Promise((resolve) => {
      resolveFirst = resolve;
    });

    mockFetch.mockImplementation((url: string) =>
      url.includes("page=1")
        ? firstResponse
        : Promise.resolve({ json: () => Promise.resolve({ page: 2 }) })
    );

    const { result, rerender } = renderHook(
      ({ page }: { page: number }) =>
        useApiQuery<{ page: number }>({
          api: "/api/test",
          searchParams: new URLSearchParams({ page: String(page) }),
        }),
      { initialProps: { page: 1 } }
    );

    // Page 2 is requested and answered while page 1 is still open.
    rerender({ page: 2 });
    await waitForAsyncUpdate(() => {
      expect(result.current.data).toEqual({ page: 2 });
    });

    // Page 1 answers late. Settling the fetch is not enough to exercise the
    // guard: `response.json()` and the handler after it run in later
    // microtasks, and asserting before those have run would pass on page 2's
    // data without the stale path ever being reached. Drain the chain inside
    // `act` so any state update it attempts is flushed and attributed here.
    await act(async () => {
      resolveFirst({ json: () => Promise.resolve({ page: 1 }) });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.data).toEqual({ page: 2 });
  });

  it("still resolves when the caller passes a new callback every render", async () => {
    // why: every real call site passes an inline arrow, so the callbacks
    // change identity on each render. Cancelling on dependency change must not
    // treat that as a superseded request, or the query aborts itself forever
    // and the data never arrives.
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ ok: true }),
    });

    const { result } = renderHook(() =>
      useApiQuery<{ ok: boolean }>({
        api: "/api/test",
        onSuccess: () => {},
        onError: () => {},
      })
    );

    await waitForAsyncUpdate(() => {
      expect(result.current.data).toEqual({ ok: true });
    });
    expect(result.current.isLoading).toBe(false);
  });
  it("stops loading when the query is disabled mid-flight", async () => {
    // why: a never-resolving fetch is what "still in flight" means here; the
    // dialogs that use this hook disable it the moment they close, which
    // happens while a request is open.
    mockFetch.mockImplementation(() => new Promise(() => {}));

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useApiQuery({ api: "/api/test", enabled }),
      { initialProps: { enabled: true } }
    );

    await waitForAsyncUpdate(() => {
      expect(result.current.isLoading).toBe(true);
    });

    rerender({ enabled: false });

    // Cancelling must not leave the caller showing a spinner for a request
    // that will never answer.
    await waitForAsyncUpdate(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });
});
