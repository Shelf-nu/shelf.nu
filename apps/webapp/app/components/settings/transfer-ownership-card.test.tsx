import { OrganizationRoles } from "@prisma/client";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../shared/tooltip";

// ── Mocks ──────────────────────────────────────────────

const mockUseRouteLoaderData = vi.fn();
const mockUseActionData = vi.fn();
const mockUseNavigation = vi.fn(() => ({ state: "idle" as const }));

// why: isolate component from react-router hooks that depend on a running router
vi.mock("react-router", async () => {
  const actual = (await vi.importActual("react-router")) as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    useRouteLoaderData: (...args: unknown[]) => mockUseRouteLoaderData(...args),
    useActionData: () => mockUseActionData(),
    useNavigation: () => mockUseNavigation(),
    Form: ({ children, ...props }: any) => <form {...props}>{children}</form>,
    Link: ({ to, children, ...rest }: any) => (
      <a {...rest} href={typeof to === "string" ? to : undefined}>
        {children}
      </a>
    ),
  };
});

// ── Component under test ──
// Dynamic import must come AFTER the vi.mock() calls above so the mocks are
// in place before transfer-ownership-card.tsx (and its transitive deps) load.

const { default: TransferOwnershipCard } = await import(
  "./transfer-ownership-card"
);

// ── Test data ──────────────────────────────────────────

const OWNER_EMAIL = "owner@example.com";

function createLayoutData({
  roles = [OrganizationRoles.ADMIN],
  isShelfAdmin = false,
}: {
  roles?: OrganizationRoles[];
  isShelfAdmin?: boolean;
} = {}) {
  return {
    currentOrganizationUserRoles: roles,
    currentOrganization: {
      id: "org-1",
      name: "Test Org",
      owner: { id: "owner-1", email: OWNER_EMAIL },
    },
    user: {
      id: "user-1",
      roles: isShelfAdmin ? [{ name: "ADMIN" }] : [],
    },
  };
}

const admin = {
  id: "admin-1",
  firstName: "Julia",
  lastName: "Mink",
  email: "julia@example.com",
};

const noSubscription = {
  hasActiveSubscription: false,
  subscriptions: [],
  tierId: null,
};

function renderCard({
  layoutData = createLayoutData(),
  admins = [admin],
  isPersonalWorkspace = false,
}: {
  layoutData?: ReturnType<typeof createLayoutData>;
  admins?: (typeof admin)[];
  isPersonalWorkspace?: boolean;
} = {}) {
  mockUseRouteLoaderData.mockReturnValue(layoutData);

  return render(
    <TooltipProvider>
      <TransferOwnershipCard
        admins={admins}
        ownerSubscriptionInfo={noSubscription}
        ownerOtherTeamWorkspacesCount={0}
        premiumIsEnabled={false}
        isPersonalWorkspace={isPersonalWorkspace}
      />
    </TooltipProvider>
  );
}

// ── Tests ──────────────────────────────────────────────

describe("TransferOwnershipCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseActionData.mockReturnValue(undefined);
    mockUseNavigation.mockReturnValue({ state: "idle" as const });
  });

  it("shows the transfer flow to the workspace owner", () => {
    renderCard({
      layoutData: createLayoutData({ roles: [OrganizationRoles.OWNER] }),
    });

    expect(
      screen.getByRole("button", { name: /transfer ownership/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /learn more/i })).toHaveAttribute(
      "href",
      expect.stringContaining("transfer-workspace-ownership")
    );
  });

  it("tells non-owner members who can transfer instead of rendering nothing", () => {
    renderCard({
      layoutData: createLayoutData({ roles: [OrganizationRoles.ADMIN] }),
    });

    const explainer = screen.getByText(/only the workspace owner/i, {
      selector: "p",
    });
    expect(explainer).toHaveTextContent(OWNER_EMAIL);
    // No transfer button for non-owners
    expect(
      screen.queryByRole("button", { name: /transfer ownership/i })
    ).not.toBeInTheDocument();
  });

  it("still shows the transfer flow to Shelf admins who are not the owner", () => {
    renderCard({
      layoutData: createLayoutData({
        roles: [OrganizationRoles.ADMIN],
        isShelfAdmin: true,
      }),
    });

    expect(
      screen.getByRole("button", { name: /transfer ownership/i })
    ).toBeInTheDocument();
  });

  it("explains the account-email alternative for personal workspaces", () => {
    renderCard({
      layoutData: createLayoutData({ roles: [OrganizationRoles.OWNER] }),
      isPersonalWorkspace: true,
    });

    expect(
      screen.getByText(/personal workspaces cannot be transferred/i, {
        selector: "p",
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /go to account settings/i })
    ).toHaveAttribute("href", "/account-details/general");
    expect(
      screen.queryByRole("button", { name: /transfer ownership/i })
    ).not.toBeInTheDocument();
  });

  it("renders an inert transfer button when the workspace has no admins", async () => {
    const user = userEvent.setup();
    renderCard({
      layoutData: createLayoutData({ roles: [OrganizationRoles.OWNER] }),
      admins: [],
    });

    // why: disabled-with-reason buttons render without the `disabled`
    // attribute (HoverCard wrapper prevents the click instead), so we assert
    // the behavior — clicking must not open the transfer dialog.
    const button = screen.getByRole("button", { name: /transfer ownership/i });
    await user.click(button);
    expect(screen.queryByText(/select new owner/i)).not.toBeInTheDocument();
  });
});
