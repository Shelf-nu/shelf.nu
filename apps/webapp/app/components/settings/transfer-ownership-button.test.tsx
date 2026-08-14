import type { AnchorHTMLAttributes, PropsWithChildren } from "react";
import { OrganizationRoles } from "@prisma/client";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────

const mockUseRouteLoaderData = vi.fn();

// why: isolate component from react-router hooks that depend on a running router
vi.mock("react-router", async () => {
  const actual = (await vi.importActual("react-router")) as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    useRouteLoaderData: (...args: unknown[]) => mockUseRouteLoaderData(...args),
    Link: ({
      to,
      children,
      ...rest
    }: PropsWithChildren<
      AnchorHTMLAttributes<HTMLAnchorElement> & { to?: unknown }
    >) => (
      <a {...rest} href={typeof to === "string" ? to : undefined}>
        {children}
      </a>
    ),
  };
});

// ── Component under test ──
// Dynamic import must come AFTER the vi.mock() calls above so the mocks are
// in place before transfer-ownership-button.tsx (and its transitive deps) load.

const { default: TransferOwnershipButton } = await import(
  "./transfer-ownership-button"
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

function renderButton(layoutData = createLayoutData()) {
  mockUseRouteLoaderData.mockReturnValue(layoutData);
  return render(<TransferOwnershipButton />);
}

// ── Tests ──────────────────────────────────────────────

describe("TransferOwnershipButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("links the workspace owner to the transfer section on general settings", () => {
    renderButton(createLayoutData({ roles: [OrganizationRoles.OWNER] }));

    expect(
      screen.getByRole("link", { name: /transfer ownership/i })
    ).toHaveAttribute("href", "/settings/general#transfer-ownership");
  });

  it("links Shelf staff admins who are not the owner the same way", () => {
    renderButton(
      createLayoutData({
        roles: [OrganizationRoles.ADMIN],
        isShelfAdmin: true,
      })
    );

    expect(
      screen.getByRole("link", { name: /transfer ownership/i })
    ).toHaveAttribute("href", "/settings/general#transfer-ownership");
  });

  it("shows non-owners an inert button whose hover reason names the owner", async () => {
    const user = userEvent.setup();
    renderButton(createLayoutData({ roles: [OrganizationRoles.ADMIN] }));

    // No link for non-owners — only an inert button
    expect(
      screen.queryByRole("link", { name: /transfer ownership/i })
    ).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: /transfer ownership/i });

    // why: disabled-with-reason buttons render without the `disabled`
    // attribute (a HoverCard wrapper prevents the click instead), so we
    // assert the behavior — the hover reason must name the owner.
    await user.hover(button);
    expect(
      await screen.findByText(
        new RegExp(`only the workspace owner \\(${OWNER_EMAIL}\\)`, "i")
      )
    ).toBeInTheDocument();
  });
});
