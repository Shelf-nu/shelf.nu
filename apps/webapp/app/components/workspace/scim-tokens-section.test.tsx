import { QrIdDisplayPreference } from "@prisma/client";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScimTokenItem } from "./edit-form";

// ── Mocks ──────────────────────────────────────────────

const mockUseFetcher = vi.fn();
const mockUseLoaderData = vi.fn();
const mockUseRouteLoaderData = vi.fn();
const mockUseNavigation = vi.fn(() => ({ state: "idle" as const }));

// why: isolate component from react-router hooks that depend on a running router
vi.mock("react-router", async () => {
  const actual = (await vi.importActual("react-router")) as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    useFetcher: (...args: unknown[]) => mockUseFetcher(...args),
    useLoaderData: () => mockUseLoaderData(),
    useRouteLoaderData: (...args: unknown[]) => mockUseRouteLoaderData(...args),
    useNavigation: () => mockUseNavigation(),
    Link: ({ to, children, ...rest }: any) => (
      <a {...rest} href={typeof to === "string" ? to : undefined}>
        {children}
      </a>
    ),
  };
});

// why: stub clipboard.writeText to prevent errors and verify copy behavior
const mockWriteText = vi.fn().mockResolvedValue(undefined);

// ── Lazy import of component under test (after mocks) ──

const { WorkspaceEditForms } = await import("./edit-form");

// ── Test data ──────────────────────────────────────────

const ssoDetails = {
  selfServiceGroupId: "group-ss",
  baseUserGroupId: "group-base",
  adminGroupId: "group-admin",
};

function createLoaderData(overrides: Record<string, unknown> = {}) {
  return {
    organization: {
      id: "org-1",
      name: "Test Org",
      enabledSso: true,
      ssoDetails,
      ...overrides,
    },
  };
}

function createFetcher(overrides: Record<string, unknown> = {}) {
  return {
    submit: vi.fn(),
    load: vi.fn(),
    data: undefined,
    state: "idle" as const,
    formData: undefined,
    Form: ({ children, ...props }: any) => <form {...props}>{children}</form>,
    ...overrides,
  };
}

function createToken(overrides: Partial<ScimTokenItem> = {}): ScimTokenItem {
  return {
    id: "token-1",
    label: "Entra ID Production",
    lastUsedAt: "2025-06-01T10:00:00Z",
    createdAt: "2025-01-15T08:00:00Z",
    ...overrides,
  };
}

// ── Route loader data by route ID ──────────────────────

const routeLoaderDefaults: Record<string, unknown> = {
  // DateS → useHints → useRequestInfo → useRouteLoaderData("root")
  root: {
    requestInfo: {
      hints: { timeZone: "UTC", locale: "en-US" },
    },
  },
  // useUserRoleHelper → useRouteLoaderData("routes/_layout+/_layout")
  "routes/_layout+/_layout": {
    currentOrganizationUserRoles: ["OWNER"],
  },
};

// ── Setup ──────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Stub clipboard.writeText on both navigator and window.navigator
  // so that the component (rendered in happy-dom) can call it
  for (const nav of [navigator, window?.navigator].filter(Boolean)) {
    if (!nav.clipboard) {
      Object.defineProperty(nav, "clipboard", {
        value: { writeText: mockWriteText },
        configurable: true,
      });
    } else {
      vi.spyOn(nav.clipboard, "writeText").mockImplementation(mockWriteText);
    }
  }

  mockUseLoaderData.mockReturnValue(createLoaderData());

  // Return different data depending on which route ID is requested
  mockUseRouteLoaderData.mockImplementation(
    (routeId: string) => routeLoaderDefaults[routeId]
  );

  // Default: both fetchers idle with no data
  mockUseFetcher.mockReturnValue(createFetcher());
});

/**
 * Renders just the SCIM tokens section by rendering WorkspaceEditForms.
 * The section is conditionally shown when isOwner + enabledSso + ssoDetails.
 */
function renderScimSection(tokens?: ScimTokenItem[]) {
  return render(
    <WorkspaceEditForms
      name="Test Org"
      currency="USD"
      qrIdDisplayPreference={QrIdDisplayPreference.QR_ID}
      scimTokens={tokens}
    />
  );
}

// ── Tests ──────────────────────────────────────────────

describe("WorkspaceScimTokensSection", () => {
  describe("Conditional rendering", () => {
    it("should render when user is owner with SSO enabled", () => {
      renderScimSection();

      expect(screen.getByText("SCIM provisioning")).toBeInTheDocument();
    });

    it("should not render when user is not owner", () => {
      mockUseRouteLoaderData.mockImplementation((routeId: string) => {
        if (routeId === "routes/_layout+/_layout") {
          return { currentOrganizationUserRoles: ["ADMIN"] };
        }
        return routeLoaderDefaults[routeId];
      });

      renderScimSection();

      expect(screen.queryByText("SCIM provisioning")).not.toBeInTheDocument();
    });

    it("should not render when SSO is disabled", () => {
      mockUseLoaderData.mockReturnValue(
        createLoaderData({ enabledSso: false })
      );

      renderScimSection();

      expect(screen.queryByText("SCIM provisioning")).not.toBeInTheDocument();
    });

    it("should not render when ssoDetails is null", () => {
      mockUseLoaderData.mockReturnValue(createLoaderData({ ssoDetails: null }));

      renderScimSection();

      expect(screen.queryByText("SCIM provisioning")).not.toBeInTheDocument();
    });
  });

  describe("Token list", () => {
    it("should show empty state when no tokens exist", () => {
      renderScimSection([]);

      expect(screen.getByText(/No active SCIM tokens/)).toBeInTheDocument();
    });

    it("should show empty state when scimTokens is undefined", () => {
      renderScimSection(undefined);

      expect(screen.getByText(/No active SCIM tokens/)).toBeInTheDocument();
    });

    it("should render token table with token data", () => {
      const tokens = [
        createToken(),
        createToken({
          id: "token-2",
          label: "Staging Token",
          lastUsedAt: null,
        }),
      ];

      renderScimSection(tokens);

      // Table headers
      expect(screen.getByText("Label")).toBeInTheDocument();
      expect(screen.getByText("Last used")).toBeInTheDocument();

      // Token data
      expect(screen.getByText("Entra ID Production")).toBeInTheDocument();
      expect(screen.getByText("Staging Token")).toBeInTheDocument();

      // "Never" shown for null lastUsedAt
      expect(screen.getByText("Never")).toBeInTheDocument();
    });

    it("should show a delete button for each token", () => {
      const tokens = [
        createToken(),
        createToken({ id: "token-2", label: "Second" }),
      ];

      renderScimSection(tokens);

      const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
      expect(deleteButtons).toHaveLength(2);
    });
  });

  describe("Generate token form", () => {
    it("should render label input and generate button", () => {
      renderScimSection();

      expect(screen.getByPlaceholderText(/Token label/)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Generate token" })
      ).toBeInTheDocument();
    });
  });

  describe("Delete confirmation dialog", () => {
    it("should open when delete button is clicked", async () => {
      const user = userEvent.setup();
      renderScimSection([createToken({ label: "My Token" })]);

      await user.click(screen.getByRole("button", { name: "Delete" }));

      expect(screen.getByText("Delete SCIM token")).toBeInTheDocument();
      expect(
        screen.getByText(/will stop working immediately/)
      ).toBeInTheDocument();
      // Token label appears in both the table and dialog text
      const dialog = screen.getByRole("alertdialog");
      expect(within(dialog).getByText(/My Token/)).toBeInTheDocument();
    });

    it("should close when cancel is clicked", async () => {
      const user = userEvent.setup();
      renderScimSection([createToken()]);

      await user.click(screen.getByRole("button", { name: "Delete" }));
      expect(screen.getByText("Delete SCIM token")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByText("Delete SCIM token")).not.toBeInTheDocument();
    });

    it("should submit delete and close dialog when confirm is clicked", async () => {
      const mockSubmit = vi.fn();
      mockUseFetcher.mockReturnValue(createFetcher({ submit: mockSubmit }));
      const user = userEvent.setup();

      renderScimSection([createToken({ id: "tok-42", label: "Old Token" })]);

      await user.click(screen.getByRole("button", { name: "Delete" }));

      // Click the delete confirmation button inside the dialog
      const dialog = screen.getByRole("alertdialog");
      await user.click(within(dialog).getByRole("button", { name: "Delete" }));

      expect(mockSubmit).toHaveBeenCalledWith(
        { intent: "deleteScimToken", tokenId: "tok-42" },
        { method: "post" }
      );
    });
  });

  describe("Token reveal dialog", () => {
    it("should show dialog when a new token is generated", () => {
      mockUseFetcher.mockReturnValue(
        createFetcher({ data: { rawToken: "shf_abc123secret" } })
      );

      renderScimSection();

      expect(screen.getByText("SCIM token generated")).toBeInTheDocument();
      expect(screen.getByText(/will not be shown again/)).toBeInTheDocument();
      expect(screen.getByText("shf_abc123secret")).toBeInTheDocument();
    });

    it("should copy token to clipboard when copy button is clicked", async () => {
      const user = userEvent.setup();
      mockUseFetcher.mockReturnValue(
        createFetcher({ data: { rawToken: "shf_copyme" } })
      );

      renderScimSection();

      await user.click(
        screen.getByRole("button", { name: "Copy to clipboard" })
      );
      // The component uses `void navigator.clipboard.writeText(...)` (fire-and-forget),
      // so flush the microtask queue to let the promise resolve
      await vi.waitFor(() => {
        expect(mockWriteText).toHaveBeenCalledWith("shf_copyme");
      });
      expect(
        screen.getByRole("button", { name: "Copied!" })
      ).toBeInTheDocument();
    });

    it("should close dialog when Done is clicked", async () => {
      const user = userEvent.setup();
      mockUseFetcher.mockReturnValue(
        createFetcher({ data: { rawToken: "shf_done" } })
      );

      renderScimSection();

      expect(screen.getByText("SCIM token generated")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Done" }));

      expect(
        screen.queryByText("SCIM token generated")
      ).not.toBeInTheDocument();
    });
  });
});
