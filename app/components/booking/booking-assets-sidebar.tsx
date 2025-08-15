import React, { useState } from "react";
import type { Prisma } from "@prisma/client";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "~/components/shared/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "~/components/shared/sheet";
import { tw } from "~/utils/tw";
import { AssetImage } from "../assets/asset-image";
import { AssetStatusBadge } from "../assets/asset-status-badge";
import { CategoryBadge } from "../assets/category-badge";
import KitImage from "../kits/kit-image";

type BookingWithAssets = Prisma.BookingGetPayload<{
  include: {
    assets: {
      select: {
        id: true;
        title: true;
        availableToBook: true;
        custody: true;
        kitId: true;
        status: true;
        mainImage: true;
        thumbnailImage: true;
        mainImageExpiration: true;
        category: {
          select: {
            id: true;
            name: true;
            color: true;
          };
        };
        kit: {
          select: {
            id: true;
            name: true;
            image: true;
            imageExpiration: true;
            category: {
              select: {
                id: true;
                name: true;
                color: true;
              };
            };
          };
        };
      };
    };
  };
}>;

interface BookingAssetsSidebarProps {
  booking: BookingWithAssets;
  trigger?: React.ReactNode;
}

// Group assets by kits and individual assets - similar to the original pagination structure
function groupAssets(assets: BookingWithAssets["assets"]) {
  const itemsMap = new Map();
  const individualAssets: any[] = [];

  assets.forEach((asset) => {
    if (asset.kitId && asset.kit) {
      // Asset belongs to a kit
      const kitId = asset.kitId;
      if (!itemsMap.has(kitId)) {
        itemsMap.set(kitId, {
          id: kitId,
          type: "kit",
          assets: [],
          kit: asset.kit,
        });
      }
      itemsMap.get(kitId)!.assets.push(asset);
    } else {
      // Individual asset
      individualAssets.push(asset);
    }
  });

  // Add individual assets as separate items
  individualAssets.forEach((asset) => {
    itemsMap.set(`asset-${asset.id}`, {
      id: `asset-${asset.id}`,
      type: "asset",
      assets: [asset],
    });
  });

  return Array.from(itemsMap.values());
}

export function BookingAssetsSidebar({
  booking,
  trigger,
}: BookingAssetsSidebarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedKits, setExpandedKits] = useState<Record<string, boolean>>({});

  const paginatedItems = groupAssets(booking.assets);

  const toggleKitExpansion = (kitId: string) => {
    setExpandedKits((prev) => ({
      ...prev,
      [kitId]: !prev[kitId],
    }));
  };

  const hasItems = booking.assets.length > 0;
  const defaultTrigger = (
    <Button
      variant="link-gray"
      onClick={hasItems ? () => setIsOpen(true) : undefined}
      className={!hasItems ? "hover:text-gray cursor-default no-underline" : ""}
    >
      {booking.assets.length} assets
    </Button>
  );

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      {trigger || defaultTrigger}

      <SheetContent className="w-full border-l-0 bg-white p-0 md:w-[85vw] md:max-w-[85vw]">
        <div className="flex h-screen w-full flex-col">
          <SheetHeader className="border-color-200 border-b px-6 py-3">
            <SheetTitle className="text-left">
              Assets in "{booking.name}"
            </SheetTitle>
            <SheetDescription className="text-left">
              {booking.assets.length}{" "}
              {booking.assets.length === 1 ? "asset" : "assets"} in this booking
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Header matching BookingAssetsColumn */}
            <div className="border border-b-0 bg-white px-4 pb-3 pt-4 text-left font-normal text-gray-600 md:mx-0 md:px-6">
              <h5 className="text-left capitalize">Assets & kits</h5>
              <p>
                <span>{paginatedItems.length} items</span>
              </p>
            </div>

            {/* Table structure matching BookingAssetsColumn */}
            <div className="flex-1 overflow-auto border border-b-0 border-gray-200 bg-white md:mx-0">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 text-left ">
                    <th className="px-6 py-3 font-normal text-gray-600">
                      Name
                    </th>
                    <th className="px-6 py-3"> </th>
                    <th className="px-6 py-3 font-normal text-gray-600">
                      Category
                    </th>
                    <th className="px-6 py-3"> </th>
                  </tr>
                </thead>
                <tbody className="">
                  {paginatedItems.map((item) => {
                    if (item.type === "kit") {
                      const kit = item.kit;
                      const isExpanded = expandedKits[item.id] ?? false;

                      if (!kit) {
                        return null;
                      }

                      return (
                        <React.Fragment key={`kit-${item.id}`}>
                          {/* Kit Row */}
                          <tr className="relative border-b border-gray-200 bg-gray-50">
                            <td className="w-full whitespace-normal p-0 md:p-0">
                              <div className="flex items-center gap-3 px-6 py-4 md:justify-normal md:pr-6">
                                <KitImage
                                  kit={{
                                    image: kit.image,
                                    imageExpiration: kit.imageExpiration,
                                    alt: kit.name,
                                    kitId: kit.id,
                                  }}
                                  className="size-12 rounded-[4px] border object-cover"
                                />
                                <div>
                                  <Button
                                    to={`/kits/${kit.id}`}
                                    variant="link"
                                    className="text-gray-900 hover:text-gray-700"
                                    target="_blank"
                                    onlyNewTabIconOnHover={true}
                                    aria-label="Go to kit"
                                  >
                                    <div className="max-w-[200px] truncate sm:max-w-[250px] md:max-w-[350px] lg:max-w-[450px]">
                                      {kit.name}
                                    </div>
                                  </Button>
                                  <p className="text-sm text-gray-600">
                                    {item.assets.length} assets
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4"> </td>
                            <td className="px-6 py-4">
                              <CategoryBadge
                                category={kit.category}
                                className="whitespace-nowrap"
                              />
                            </td>
                            <td className="px-6 py-4 pr-4 text-right align-middle">
                              <div className="flex items-center justify-end gap-5">
                                <Button
                                  onClick={() => toggleKitExpansion(kit.id)}
                                  variant="link"
                                  className="text-center font-bold text-gray-600 hover:text-gray-900"
                                  aria-label="Toggle kit expand"
                                >
                                  <ChevronDownIcon
                                    className={tw(
                                      `size-6 ${
                                        !isExpanded ? "rotate-180" : ""
                                      }`
                                    )}
                                  />
                                </Button>
                              </div>
                            </td>
                          </tr>

                          {/* Kit Assets (when expanded) */}
                          {isExpanded &&
                            item.assets.map((asset: any) => (
                              <tr
                                key={`kit-asset-${asset.id}`}
                                className="relative border-b border-gray-200"
                              >
                                <td className="w-full whitespace-normal p-0 md:p-0">
                                  <div className="absolute inset-y-0 left-0 h-full w-2 bg-gray-100" />
                                  <div className="flex justify-between gap-3 bg-gray-50/50 px-6 py-4 md:justify-normal md:pr-6">
                                    <div className="flex items-center gap-3">
                                      <div className="relative flex size-12 shrink-0 items-center justify-center">
                                        <AssetImage
                                          asset={{
                                            id: asset.id,
                                            mainImage: asset.mainImage,
                                            thumbnailImage:
                                              asset.thumbnailImage,
                                            mainImageExpiration:
                                              asset.mainImageExpiration,
                                          }}
                                          alt={asset.title}
                                          className="size-full rounded-[4px] border border-gray-300 object-cover"
                                          withPreview
                                        />
                                      </div>
                                      <div className="min-w-[180px]">
                                        <span className="word-break mb-1 block">
                                          <Button
                                            to={`/assets/${asset.id}`}
                                            variant="link"
                                            className="text-left font-medium text-gray-900 hover:text-gray-700"
                                            target="_blank"
                                            onlyNewTabIconOnHover={true}
                                          >
                                            {asset.title}
                                          </Button>
                                        </span>
                                        <div>
                                          <AssetStatusBadge
                                            id={asset.id}
                                            status={asset.status}
                                            availableToBook={
                                              asset.availableToBook
                                            }
                                          />
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </td>
                                <td className="bg-gray-50/50 px-6 py-4"> </td>
                                <td className="bg-gray-50/50 px-6 py-4">
                                  <CategoryBadge
                                    category={asset.category}
                                    className="whitespace-nowrap"
                                  />
                                </td>
                                <td className="bg-gray-50/50 px-6 py-4 pr-4 text-right">
                                  {" "}
                                </td>
                              </tr>
                            ))}

                          {/* Separator row after kit assets */}
                          <tr className="kit-separator h-1 bg-gray-100">
                            <td colSpan={4} className="h-1 p-0"></td>
                          </tr>
                        </React.Fragment>
                      );
                    }

                    // Individual asset
                    const asset = item.assets[0];
                    return (
                      <tr
                        key={`asset-${asset.id}`}
                        className="border-b border-gray-200"
                      >
                        <td className="w-full whitespace-normal p-0 md:p-0">
                          <div className="flex justify-between gap-3 px-6 py-4 md:justify-normal md:pr-6">
                            <div className="flex items-center gap-3">
                              <div className="relative flex size-12 shrink-0 items-center justify-center">
                                <AssetImage
                                  asset={{
                                    id: asset.id,
                                    mainImage: asset.mainImage,
                                    thumbnailImage: asset.thumbnailImage,
                                    mainImageExpiration:
                                      asset.mainImageExpiration,
                                  }}
                                  alt={asset.title}
                                  className="size-full rounded-[4px] border object-cover"
                                  withPreview
                                />
                              </div>
                              <div className="min-w-[180px]">
                                <span className="word-break mb-1 block">
                                  <Button
                                    to={`/assets/${asset.id}`}
                                    variant="link"
                                    className="text-left font-medium text-gray-900 hover:text-gray-700"
                                    target="_blank"
                                    onlyNewTabIconOnHover={true}
                                  >
                                    {asset.title}
                                  </Button>
                                </span>
                                <div>
                                  <AssetStatusBadge
                                    id={asset.id}
                                    status={asset.status}
                                    availableToBook={asset.availableToBook}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4"> </td>
                        <td className="px-6 py-4">
                          <CategoryBadge
                            category={asset.category}
                            className="whitespace-nowrap"
                          />
                        </td>
                        <td className="px-6 py-4 pr-4 text-right"> </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
