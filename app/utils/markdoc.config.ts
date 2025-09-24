import type { Config } from "@markdoc/markdoc";

/**
 * Markdoc configuration for Shelf.nu
 *
 * This configuration defines custom tags and components for enhanced markdown rendering.
 * Currently includes:
 * - date tag: Renders dates with proper localization and timezone support
 * - assets_list tag: Renders interactive asset count with popover showing asset details
 * - kits_list tag: Renders interactive kit count with popover showing kit details
 */

export const markdocConfig: Config = {
  tags: {
    date: {
      render: "DateComponent",
      description:
        "Renders a date with proper localization and timezone support",
      attributes: {
        value: {
          type: String,
          required: true,
          description: "ISO date string to be formatted",
        },
        includeTime: {
          type: Boolean,
          default: true,
          description: "Whether to include time in the formatted output",
        },
      },
      selfClosing: true,
    },
    assets_list: {
      render: "AssetsListComponent",
      description:
        "Renders an interactive asset count with popover showing asset names",
      attributes: {
        count: {
          type: Number,
          required: true,
          description: "Number of assets in the list",
        },
        ids: {
          type: String,
          required: true,
          description: "Comma-separated list of asset IDs",
        },
        action: {
          type: String,
          required: true,
          description: "Action performed (added, removed, etc.)",
        },
      },
      selfClosing: true,
    },
    kits_list: {
      render: "KitsListComponent",
      description:
        "Renders an interactive kit count with popover showing kit names",
      attributes: {
        count: {
          type: Number,
          required: true,
          description: "Number of kits in the list",
        },
        ids: {
          type: String,
          required: true,
          description: "Comma-separated list of kit IDs",
        },
        action: {
          type: String,
          required: true,
          description: "Action performed (added, removed, etc.)",
        },
      },
      selfClosing: true,
    },
    link: {
      render: "LinkComponent",
      description:
        "Renders a link that opens in a new tab with consistent styling",
      attributes: {
        to: {
          type: String,
          required: true,
          description: "URL path for the link",
        },
        text: {
          type: String,
          required: true,
          description: "Display text for the link",
        },
      },
      selfClosing: true,
    },
  },
};
