import { Spinner } from "./spinner";

import {
  ArchiveIcon,
  CoinsIcon,
  MailIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  SuccessIcon,
  TrashIcon,
  XIcon,
} from "../icons/library";

/** The possible options for icons to be rendered in the button */
export type Icon =
  | "plus"
  | "trash"
  | "archive"
  | "mail"
  | "search"
  | "spinner"
  | "x"
  | "refresh"
  | "coins"
  | "success";

type IconsMap = {
  [key in Icon]: JSX.Element;
};

export const iconsMap: IconsMap = {
  plus: <PlusIcon />,
  trash: <TrashIcon />,
  archive: <ArchiveIcon />,
  mail: <MailIcon />,
  search: <SearchIcon />,
  spinner: <Spinner />,
  x: <XIcon />,
  refresh: <RefreshIcon />,
  coins: <CoinsIcon />,
  success: <SuccessIcon />,
};

export default iconsMap;
