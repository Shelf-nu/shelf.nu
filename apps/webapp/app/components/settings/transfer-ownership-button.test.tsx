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
  owner = { id: "owner-1", email: OWNER_EMAIL } as {
    id: string;
    email: string;
  } | null,
}: {
  roles?: OrganizationRoles[];
  isShelfAdmin?: boolean;
  /** `null` mirrors a loader payload that stopped selecting the owner. */
  owner?: { id: string; email: string } | null;
} = {}) {
  return {
    currentOrganizationUserRoles: roles,
    currentOrganization: {
      id: "org-1",
      name: "Test Org",
      owner,
    },
    // Shelf staff admin flag, as derived by the _layout loader
    isAdmin: isShelfAdmin,
    user: { id: "user-1" },
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
    // assert the behavior — the reason must name the owner, both on hover
    // and to assistive tech.
    await user.hover(button);
    expect(
      await screen.findAllByText(
        new RegExp(`only the workspace owner \\(${OWNER_EMAIL}\\)`, "i")
      )
    ).not.toHaveLength(0);

    expect(
      document.getElementById(button.getAttribute("aria-describedby") as string)
    ).toHaveTextContent(new RegExp(OWNER_EMAIL, "i"));
  });

  it("falls back to a generic reason when the loader ships no owner", () => {
    renderButton(
      createLayoutData({ roles: [OrganizationRoles.ADMIN], owner: null })
    );

    const button = screen.getByRole("button", { name: /transfer ownership/i });

    // No stray "()" where the email would have gone
    expect(
      document.getElementById(button.getAttribute("aria-describedby") as string)
    ).toHaveTextContent(
      /^only the workspace owner can transfer ownership of this workspace\.$/i
    );
  });
});
