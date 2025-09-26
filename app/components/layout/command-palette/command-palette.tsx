import { useEffect, useMemo, useState } from "react";
import type { SerializeFrom } from "@remix-run/node";
import { useNavigate, useRouteLoaderData } from "@remix-run/react";
import Fuse from "fuse.js";
import {
  CalendarIcon,
  CompassIcon,
  FilePlus2Icon,
  LayoutDashboardIcon,
  MapPinIcon,
  PackageIcon,
  SearchIcon,
  SettingsIcon,
  UserIcon,
  UserPlus2Icon,
} from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "~/components/shared/command";
import { Spinner } from "~/components/shared/spinner";
import useApiQuery from "~/hooks/use-api-query";
import type { LayoutLoaderResponse } from "~/routes/_layout+/_layout";
import type { DataOrErrorResponse } from "~/utils/http.server";
import { tw } from "~/utils/tw";
import { useCommandPalette } from "./command-palette-context";

const ASSET_RESULTS_LIMIT = 10;
const SEARCH_DEBOUNCE_MS = 300;

export type CommandPaletteSearchResponse = DataOrErrorResponse<{
  query: string;
  assets: AssetSearchResult[];
  kits: KitSearchResult[];
  bookings: BookingSearchResult[];
  locations: LocationSearchResult[];
  teamMembers: TeamMemberSearchResult[];
}>;

export type AssetSearchResult = {
  id: string;
  title: string;
  sequentialId: string | null;
  mainImage: string | null;
  mainImageExpiration: string | null;
  locationName: string | null;
};

export type KitSearchResult = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  assetCount: number;
};

export type BookingSearchResult = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  custodianName: string | null;
  from: string | null;
  to: string | null;
};

export type LocationSearchResult = {
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  assetCount: number;
};

export type TeamMemberSearchResult = {
  id: string;
  name: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
};

type QuickCommand = {
  id: string;
  label: string;
  description?: string;
  href: string;
  keywords?: string[];
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
};

type QuickAction = QuickCommand & {
  isVisible?: (context: CommandContext) => boolean;
};

type CommandContext = {
  canInviteUsers: boolean;
  canCreateBookings: boolean;
};

const NAVIGATION_COMMANDS: QuickCommand[] = [
  {
    id: "assets",
    label: "Assets",
    description: "Browse and manage all assets",
    href: "/assets",
    keywords: ["inventory", "items", "equipment"],
    icon: CompassIcon,
  },
  {
    id: "bookings",
    label: "Bookings",
    description: "View upcoming and past bookings",
    href: "/bookings",
    keywords: ["reservations", "schedule", "calendar"],
    icon: CalendarIcon,
  },
  {
    id: "team",
    label: "Team",
    description: "Manage team members and roles",
    href: "/team",
    keywords: ["users", "members", "people"],
    icon: UserPlus2Icon,
  },
  {
    id: "settings",
    label: "Settings",
    description: "Adjust organization preferences",
    href: "/settings",
    keywords: ["preferences", "configuration"],
    icon: SettingsIcon,
  },
  {
    id: "dashboard",
    label: "Dashboard",
    description: "See analytics and key metrics",
    href: "/dashboard",
    keywords: ["overview", "analytics"],
    icon: LayoutDashboardIcon,
  },
];

const ACTION_COMMANDS: QuickAction[] = [
  {
    id: "create-asset",
    label: "Create asset",
    description: "Add a new asset to your inventory",
    href: "/assets/new",
    keywords: ["new", "asset", "inventory"],
    icon: FilePlus2Icon,
  },
  {
    id: "create-booking",
    label: "Create booking",
    description: "Reserve assets for a new booking",
    href: "/bookings/new",
    keywords: ["book", "reservation", "calendar"],
    icon: CalendarIcon,
    isVisible: ({ canCreateBookings }) => canCreateBookings,
  },
  {
    id: "invite-user",
    label: "Invite user",
    description: "Send an invite to a teammate",
    href: "/settings/team/invites",
    keywords: ["team", "user", "invite"],
    icon: UserPlus2Icon,
    isVisible: ({ canInviteUsers }) => canInviteUsers,
  },
];

function getShortcutLabel() {
  if (typeof navigator === "undefined") {
    return "⌘K";
  }

  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "⌘K" : "Ctrl K";
}

function getAssetImage(asset: AssetSearchResult) {
  if (!asset.mainImage) {
    return "/static/images/asset-placeholder.jpg";
  }

  if (!asset.mainImageExpiration) {
    return asset.mainImage;
  }

  const expiration = new Date(asset.mainImageExpiration);
  return expiration.getTime() < Date.now()
    ? "/static/images/asset-placeholder.jpg"
    : asset.mainImage;
}

export function getAssetCommandValue(asset: AssetSearchResult) {
  const searchableFields = [
    asset.title,
    asset.sequentialId ?? "",
    asset.id,
    asset.locationName ?? "",
  ].filter(Boolean);

  return [`asset-${asset.id}`, ...searchableFields].join(" ").trim();
}

export function getKitCommandValue(kit: KitSearchResult) {
  const searchableFields = [kit.name, kit.description ?? "", kit.id].filter(
    Boolean
  );

  return [`kit-${kit.id}`, ...searchableFields].join(" ").trim();
}

export function getBookingCommandValue(booking: BookingSearchResult) {
  const searchableFields = [
    booking.name,
    booking.description ?? "",
    booking.custodianName ?? "",
    booking.id,
  ].filter(Boolean);

  return [`booking-${booking.id}`, ...searchableFields].join(" ").trim();
}

export function getLocationCommandValue(location: LocationSearchResult) {
  const searchableFields = [
    location.name,
    location.description ?? "",
    location.address ?? "",
    location.id,
  ].filter(Boolean);

  return [`location-${location.id}`, ...searchableFields].join(" ").trim();
}

export function getTeamMemberCommandValue(member: TeamMemberSearchResult) {
  const searchableFields = [
    member.name,
    member.email ?? "",
    member.firstName ?? "",
    member.lastName ?? "",
    member.id,
  ].filter(Boolean);

  return [`member-${member.id}`, ...searchableFields].join(" ").trim();
}

export function CommandPalette() {
  const { open, setOpen } = useCommandPalette();
  const navigate = useNavigate();
  const layoutData = useRouteLoaderData<SerializeFrom<LayoutLoaderResponse>>(
    "routes/_layout+/_layout"
  );

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const searchParams = useMemo(() => {
    if (!debouncedQuery) return undefined;
    return new URLSearchParams({ q: debouncedQuery });
  }, [debouncedQuery]);

  const {
    data: searchData,
    isLoading,
    error: fetchError,
  } = useApiQuery<CommandPaletteSearchResponse>({
    api: "/api/command-palette/search",
    searchParams,
    enabled: open && Boolean(debouncedQuery),
  });

  const canInviteUsers = useMemo(() => {
    const roles = layoutData?.currentOrganizationUserRoles ?? [];
    return roles.includes("ADMIN") || roles.includes("OWNER");
  }, [layoutData?.currentOrganizationUserRoles]);

  const canCreateBookings = layoutData?.canUseBookings ?? false;

  const commandContext = useMemo<CommandContext>(
    () => ({
      canInviteUsers,
      canCreateBookings,
    }),
    [canInviteUsers, canCreateBookings]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen(!open);
      }

      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setDebouncedQuery("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
  }, [query, open]);

  const navigationResults = useMemo(() => {
    if (!query) {
      return NAVIGATION_COMMANDS;
    }

    const fuse = new Fuse(NAVIGATION_COMMANDS, {
      keys: ["label", "description", "keywords"],
      threshold: 0.4,
      ignoreLocation: true,
    });

    return fuse.search(query).map((result) => result.item);
  }, [query]);

  const availableActions = useMemo(
    () =>
      ACTION_COMMANDS.filter((action) =>
        action.isVisible ? action.isVisible(commandContext) : true
      ),
    [commandContext]
  );

  const actionResults = useMemo(() => {
    if (!query) {
      return availableActions;
    }

    const fuse = new Fuse(availableActions, {
      keys: ["label", "description", "keywords"],
      threshold: 0.4,
      ignoreLocation: true,
    });

    return fuse.search(query).map((result) => result.item);
  }, [availableActions, query]);

  const assetResults = useMemo(() => {
    if (!searchData || searchData.error) {
      return [];
    }
    return searchData.assets || [];
  }, [searchData]);

  const kitResults = useMemo(() => {
    if (!searchData || searchData.error) {
      return [];
    }
    return searchData.kits || [];
  }, [searchData]);

  const bookingResults = useMemo(() => {
    if (!searchData || searchData.error) {
      return [];
    }
    return searchData.bookings || [];
  }, [searchData]);

  const locationResults = useMemo(() => {
    if (!searchData || searchData.error) {
      return [];
    }
    return searchData.locations || [];
  }, [searchData]);

  const teamMemberResults = useMemo(() => {
    if (!searchData || searchData.error) {
      return [];
    }
    return searchData.teamMembers || [];
  }, [searchData]);

  const assetMatches = useMemo(
    () => assetResults.slice(0, ASSET_RESULTS_LIMIT),
    [assetResults]
  );

  const isSearching = isLoading;
  const errorMessage = fetchError || searchData?.error?.message;

  const shortcutLabel = useMemo(() => getShortcutLabel(), []);

  const handleSelect = (href: string) => {
    setOpen(false);
    navigate(href);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search assets, kits, bookings, locations, team members..."
        autoFocus
        className="my-4 rounded border-gray-100"
      />
      <CommandList className="divide-y divide-gray-100">
        <CommandEmpty>
          {isSearching ? (
            <span className="flex items-center gap-2 text-gray-500">
              <Spinner className="size-4" /> Searching...
            </span>
          ) : errorMessage ? (
            <span className="text-error-600">
              {errorMessage || "Something went wrong"}
            </span>
          ) : (
            "No results found"
          )}
        </CommandEmpty>

        {assetMatches.length > 0 ? (
          <CommandGroup heading="Assets">
            {assetMatches.map((asset) => (
              <CommandItem
                key={asset.id}
                value={getAssetCommandValue(asset)}
                onSelect={() => handleSelect(`/assets/${asset.id}`)}
                className="gap-3"
              >
                <div className="flex size-10 items-center justify-center overflow-hidden rounded-md border border-gray-200 bg-gray-100">
                  <img
                    src={getAssetImage(asset)}
                    alt={asset.title}
                    className="size-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium text-gray-900">
                    {asset.title}
                  </span>
                  <span className="truncate text-xs text-gray-500">
                    {asset.sequentialId || asset.id}
                    {asset.locationName ? ` • ${asset.locationName}` : ""}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {kitResults.length > 0 ? (
          <CommandGroup heading="Kits">
            {kitResults.map((kit) => (
              <CommandItem
                key={kit.id}
                value={getKitCommandValue(kit)}
                onSelect={() => handleSelect(`/kits/${kit.id}`)}
                className="gap-3"
              >
                <PackageIcon className="size-4 text-gray-500" />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium text-gray-900">
                    {kit.name}
                  </span>
                  <span className="truncate text-xs text-gray-500">
                    {kit.status} • {kit.assetCount} assets
                    {kit.description ? ` • ${kit.description}` : ""}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {bookingResults.length > 0 ? (
          <CommandGroup heading="Bookings">
            {bookingResults.map((booking) => (
              <CommandItem
                key={booking.id}
                value={getBookingCommandValue(booking)}
                onSelect={() => handleSelect(`/bookings/${booking.id}`)}
                className="gap-3"
              >
                <CalendarIcon className="size-4 text-gray-500" />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium text-gray-900">
                    {booking.name}
                  </span>
                  <span className="truncate text-xs text-gray-500">
                    {booking.status}
                    {booking.custodianName ? ` • ${booking.custodianName}` : ""}
                    {booking.from && booking.to
                      ? ` • ${new Date(
                          booking.from
                        ).toLocaleDateString()} - ${new Date(
                          booking.to
                        ).toLocaleDateString()}`
                      : ""}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {locationResults.length > 0 ? (
          <CommandGroup heading="Locations">
            {locationResults.map((location) => (
              <CommandItem
                key={location.id}
                value={getLocationCommandValue(location)}
                onSelect={() => handleSelect(`/locations/${location.id}`)}
                className="gap-3"
              >
                <MapPinIcon className="size-4 text-gray-500" />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium text-gray-900">
                    {location.name}
                  </span>
                  <span className="truncate text-xs text-gray-500">
                    {location.assetCount} assets
                    {location.address ? ` • ${location.address}` : ""}
                    {location.description ? ` • ${location.description}` : ""}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {teamMemberResults.length > 0 ? (
          <CommandGroup heading="Team Members">
            {teamMemberResults.map((member) => (
              <CommandItem
                key={member.id}
                value={getTeamMemberCommandValue(member)}
                onSelect={() =>
                  handleSelect(`/settings/team/members/${member.id}`)
                }
                className="gap-3"
              >
                <UserIcon className="size-4 text-gray-500" />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium text-gray-900">
                    {member.name}
                  </span>
                  <span className="truncate text-xs text-gray-500">
                    {member.email || "No email"}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {navigationResults.length > 0 ? (
          <CommandGroup heading="Navigation">
            {navigationResults.map((command) => (
              <CommandItem
                key={command.id}
                value={[
                  `nav-${command.id}`,
                  command.label,
                  command.description,
                  command.keywords?.join(" ") ?? "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onSelect={() => handleSelect(command.href)}
              >
                <command.icon className="size-4 text-gray-500" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-gray-900">
                    {command.label}
                  </span>
                  {command.description ? (
                    <span className="text-xs text-gray-500">
                      {command.description}
                    </span>
                  ) : null}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {actionResults.length > 0 ? (
          <CommandGroup heading="Quick actions">
            {actionResults.map((command) => (
              <CommandItem
                key={command.id}
                value={[
                  `action-${command.id}`,
                  command.label,
                  command.description,
                  command.keywords?.join(" ") ?? "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onSelect={() => handleSelect(command.href)}
              >
                <command.icon className="size-4 text-gray-500" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-gray-900">
                    {command.label}
                  </span>
                  {command.description ? (
                    <span className="text-xs text-gray-500">
                      {command.description}
                    </span>
                  ) : null}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>

      <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-xs text-gray-500">
        <div className="flex items-center gap-2">
          <SearchIcon className="size-4" />
          Search across all assets, kits, bookings, locations, and team members
        </div>
        <CommandShortcut className={tw("bg-white")}>
          {shortcutLabel}
        </CommandShortcut>
      </div>
      <div className="border-t border-gray-100 px-4 pb-4 pt-2 text-[11px] text-gray-400">
        <span className="font-medium text-gray-500">Keyboard tips:</span> ↑↓ to
        navigate • ↵ to select • esc to close
      </div>
    </CommandDialog>
  );
}
