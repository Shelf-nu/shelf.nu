/**
 * Regression test for SHELF-WEBAPP-22B — SSR crash on `GET /qr/:qrId/link/kit`.
 *
 * `userHasPermission` lives in `permission.validator.client.ts`, a `.client.ts`
 * module. React Router's Vite plugin stubs every export of a `.client.ts`
 * module to `undefined` in the server bundle, so calling it directly during
 * render throws `TypeError: userHasPermission is not a function` on SSR.
 * Routes nested under `_layout+/_layout` are shielded from this because that
 * layout defers rendering until the client hydrates (see the comment in
 * `_layout+/_layout.tsx`); this `qr+/_private+` route tree has no such
 * wrapper, so the component crashed on first (server) render.
 *
 * The fix derives the permission gate server-side in the loader — it already
 * calls `requirePermission({ entity: qr, action: update })`, so reaching the
 * render is itself proof the check passed — and threads it down as
 * `canManageQrLink` loader data instead of re-checking with the client-only
 * validator inside the component.
 *
 * @see {@link file://../../../../app/routes/qr+/_private+/$qrId_.link.kit.tsx}
 */
import type { ReactNode } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { MemoryRouter, useLoaderData } from "react-router";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPaginatedAndFilterableKits } from "~/modules/kit/service.server";
import { getQr } from "~/modules/qr/service.server";
import QrLinkExisting, { loader } from "~/routes/qr+/_private+/$qrId_.link.kit";
import { requirePermission } from "~/utils/roles.server";

// why: isolate the route component from heavy presentational children
// (List, Header, Filters, DynamicDropdown) so the test targets only the
// Custodian-filter permission gate, not their own internal hooks / network
// calls (List and DynamicDropdown read loader data / hit fetchers themselves).
vi.mock("~/components/list", () => ({ List: () => null }));
vi.mock("~/components/layout/header", () => ({ default: () => null }));
vi.mock("~/components/list/filters", () => ({
  Filters: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("~/components/dynamic-dropdown/dynamic-dropdown", () => ({
  default: ({ trigger }: { trigger: ReactNode }) => (
    <div data-testid="custodian-dropdown">{trigger}</div>
  ),
}));

vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));
vi.mock("~/modules/qr/service.server", () => ({ getQr: vi.fn() }));
vi.mock("~/modules/kit/service.server", () => ({
  getPaginatedAndFilterableKits: vi.fn(),
  updateKitQrCode: vi.fn(),
}));
vi.mock("~/database/db.server", () => ({
  db: {
    teamMember: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  },
}));

// why: `permission.validator.client.ts` is stubbed to `undefined` exports in
// the real production SSR bundle — that's the actual root cause of
// SHELF-WEBAPP-22B. Mocking it identically here reproduces that exact
// condition: before the fix the component called `userHasPermission(...)`
// directly and this mock made that throw; after the fix nothing in the
// component imports it, so this mock has no effect and the test still passes.
vi.mock("~/utils/permissions/permission.validator.client", () => ({
  userHasPermission: undefined,
}));

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...(actual as Record<string, unknown>),
    useLoaderData: vi.fn(),
    useParams: vi.fn(() => ({ qrId: "qr-1" })),
    // why: mirrors real production behaviour for this exact route.
    // `qr+/_private+` is not nested under `_layout+/_layout`, so
    // `useRouteLoaderData("routes/_layout+/_layout")` (called by
    // `useUserRoleHelper`) resolves to `undefined` there — it does NOT
    // throw. Modeling that precisely (rather than letting the real hook
    // throw "must be used within a data router" for lack of a full router
    // in this test) means the pre-fix component fails for the SAME reason
    // it does in production: calling the `.client.ts`-stubbed
    // `userHasPermission` with `roles: undefined`.
    useRouteLoaderData: vi.fn(() => undefined),
    useFetcher: vi.fn(() => ({
      Form: (props: Record<string, unknown>) => <form {...props} />,
      data: undefined,
      state: "idle",
      submit: vi.fn(),
    })),
  };
});

const requirePermissionMock = vi.mocked(requirePermission);
const getQrMock = vi.mocked(getQr);
const getPaginatedAndFilterableKitsMock = vi.mocked(
  getPaginatedAndFilterableKits
);
const useLoaderDataMock = vi.mocked(useLoaderData);

function createLoaderArgs(
  overrides: Partial<LoaderFunctionArgs> = {}
): LoaderFunctionArgs {
  return {
    context: { getSession: () => ({ userId: "user-123" }) },
    params: { qrId: "qr-1" },
    request: new Request("https://example.com/qr/qr-1/link/kit"),
    ...overrides,
  } as LoaderFunctionArgs;
}

describe("qr+/_private+/$qrId_.link.kit loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("threads canManageQrLink through as loader data once requirePermission passes", async () => {
    getQrMock.mockResolvedValue({
      id: "qr-1",
      assetId: null,
      kitId: null,
    } as any);
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
    } as any);
    getPaginatedAndFilterableKitsMock.mockResolvedValue({
      kits: [],
      totalKits: 0,
      perPage: 20,
      page: 1,
      totalPages: 0,
      search: null,
    } as any);

    const result = await loader(createLoaderArgs());

    // `requirePermission` above resolving (rather than throwing) is the only
    // way this line is reached, so `canManageQrLink` must be `true`.
    expect(result).toEqual(expect.objectContaining({ canManageQrLink: true }));
  });
});

describe("QrLinkExisting component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders (no SSR crash) and shows the Custodian filter when canManageQrLink is true", () => {
    useLoaderDataMock.mockReturnValue({
      header: { title: "Link with existing asset", subHeading: "Choose a kit" },
      qrId: "qr-1",
      canManageQrLink: true,
      items: [],
      teamMembers: [],
      totalTeamMembers: 0,
    });

    // Before the fix, this threw `TypeError: userHasPermission is not a
    // function` — reproduced above by stubbing that import to `undefined`,
    // matching how React Router's Vite plugin treats `.client.ts` exports
    // during SSR.
    expect(() =>
      render(
        <MemoryRouter>
          <QrLinkExisting />
        </MemoryRouter>
      )
    ).not.toThrow();

    expect(screen.getByTestId("custodian-dropdown")).toBeInTheDocument();
    expect(screen.getByText("Custodian")).toBeInTheDocument();
  });

  it("hides the Custodian filter when canManageQrLink is false", () => {
    useLoaderDataMock.mockReturnValue({
      header: { title: "Link with existing asset", subHeading: "Choose a kit" },
      qrId: "qr-1",
      canManageQrLink: false,
      items: [],
      teamMembers: [],
      totalTeamMembers: 0,
    });

    render(
      <MemoryRouter>
        <QrLinkExisting />
      </MemoryRouter>
    );

    expect(screen.queryByTestId("custodian-dropdown")).not.toBeInTheDocument();
  });
});
