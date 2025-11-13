/** This interface describes the Header object that can be returned as part of the data of each route.
 * The this object caries information about the:
 * - title
 * - subtitle
 * - actions
 *
 * Those will be rendered on on top of the layout
 */

import type { LinkProps } from "react-router";
import type { IconType } from "~/components/shared/icons-map";

export interface HeaderData {
  /** Heading/title that will be rendered on top of the view */
  title: string;

  /** Subheading rendered below the heading */
  subHeading?: string;
}

export type Action = {
  /** Name of the component that should be rendered */
  component: string;

  /** Props to be passed to the component */
  props: LinkProps & {
    /** Optional id used for testing it Playwright */
    "data-test-id"?: string;

    /** The possible options for icons to be rendered in the button */
    icon: IconType;

    /** The button variant. Default is primary */
    variant?: ButtonVariant;

    /** Width of the button. Default is auto */
    width?: ButtonWidth;

    /** Is this button disabled */
    disabled?: boolean;
  };

  /** Children to be rendered inside the component. Can only be a string as components are not serializable so they cannot be returned as part of the json response */
  children: string;
};

/** The button variant. Default is primary */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "tertiary"
  | "link"
  | "link-gray"
  | "block-link"
  | "block-link-gray"
  | "danger"
  | "info"
  | "inherit";

/** Width of the button. Default is auto */
export type ButtonWidth = "auto" | "full";
