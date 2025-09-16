import { useEffect, useMemo, useState } from "react";
import type { SerializeFrom } from "@remix-run/node";
import { useFetcher, useNavigate, useRouteLoaderData } from "@remix-run/react";
import Fuse from "fuse.js";
import {
  CalendarIcon,
  CompassIcon,
  FilePlus2Icon,
  LayoutDashboardIcon,
  SearchIcon,
  SettingsIcon,
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
import type { LayoutLoaderResponse } from "~/routes/_layout+/_layout";
import type { DataOrErrorResponse } from "~/utils/http.server";
import { tw } from "~/utils/tw";
import { useCommandPalette } from "./command-palette-context";

const ASSET_RESULTS_LIMIT = 10;
const SEARCH_DEBOUNCE_MS = 300;

export type CommandPaletteSearchResponse = DataOrErrorResponse<{
  assets: AssetSearchResult[];
}>;

export type AssetSearchResult = {
  id: string;
  title: string;
  sequentialId: string | null;
  mainImage: string | null;
  mainImageExpiration: string | null;
  locationName: string | null;
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

export function CommandPalette() {
  const { open, setOpen } = useCommandPalette();
  const fetcher = useFetcher<CommandPaletteSearchResponse>();
  const navigate = useNavigate();
  const layoutData = useRouteLoaderData<SerializeFrom<LayoutLoaderResponse>>(
    "routes/_layout+/_layout"
  );

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [assetResults, setAssetResults] = useState<AssetSearchResult[]>([]);

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
      setAssetResults([]);
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

  useEffect(() => {
    if (!open) {
      return;
    }

    if (!debouncedQuery) {
      setAssetResults([]);
      return;
    }

    const searchParams = new URLSearchParams({ q: debouncedQuery });
    fetcher.load(`/api/command-palette/search?${searchParams.toString()}`);
  }, [debouncedQuery, fetcher, open]);

  useEffect(() => {
    if (!fetcher.data) {
      return;
    }

    if ("assets" in fetcher.data && Array.isArray(fetcher.data.assets)) {
      setAssetResults(fetcher.data.assets);
    } else if (fetcher.data.error) {
      setAssetResults([]);
    }
  }, [fetcher.data]);

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

  const assetMatches = useMemo(() => {
    if (!assetResults.length) {
      return [];
    }

    if (!query) {
      return assetResults.slice(0, ASSET_RESULTS_LIMIT);
    }

    const fuse = new Fuse(assetResults, {
      keys: ["title", "sequentialId", "id", "locationName"],
      threshold: 0.35,
      ignoreLocation: true,
    });

    return fuse
      .search(query)
      .slice(0, ASSET_RESULTS_LIMIT)
      .map((result) => result.item);
  }, [assetResults, query]);

  const isSearching = fetcher.state === "loading";
  const fetchError = fetcher.data?.error;

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
        placeholder="Search assets or type a command..."
        autoFocus
      />
      <CommandList className="divide-y divide-gray-100">
        <CommandEmpty>
          {isSearching ? (
            <span className="flex items-center gap-2 text-gray-500">
              <Spinner className="size-4" /> Searching...
            </span>
          ) : fetchError ? (
            <span className="text-error-600">
              {fetchError.message || "Something went wrong"}
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
                value={`asset-${asset.id}`}
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

        {navigationResults.length > 0 ? (
          <CommandGroup heading="Navigation">
            {navigationResults.map((command) => (
              <CommandItem
                key={command.id}
                value={`nav-${command.id}`}
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
                value={`action-${command.id}`}
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
          Use keywords, asset IDs, serials, or locations
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
