import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import useApiQuery from "./use-api-query";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

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
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
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
    expect(mockFetch).toHaveBeenCalledWith("/api/test");

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
      expect(mockFetch).toHaveBeenCalledWith("/api/assets?page=1&limit=10");
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
      expect(mockFetch).toHaveBeenCalledWith("/api/test1");
    });

    // Change the API endpoint
    rerender({ api: "/api/test2" });

    await waitForAsyncUpdate(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/test2");
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
      expect(mockFetch).toHaveBeenCalledWith("/api/test?page=1");
    });

    // Change search params
    rerender({ searchParams: searchParams2 });

    await waitForAsyncUpdate(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/test?page=2");
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
      expect(mockFetch).toHaveBeenCalledWith("/api/test");
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
      expect(mockFetch).toHaveBeenCalledWith("/api/health");
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
});
