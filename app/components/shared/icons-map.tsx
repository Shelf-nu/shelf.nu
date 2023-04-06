import { Spinner } from "./spinner";

import {
  ArchiveIcon,
  CoinsIcon,
  MailIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
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
  | "coins";

type IconsMap = {
  [key in Icon]: JSX.Element;
};

const iconsMap: IconsMap = {
  plus: <PlusIcon />,
  trash: <TrashIcon />,
  archive: <ArchiveIcon />,
  mail: <MailIcon />,
  search: <SearchIcon />,
  spinner: <Spinner />,
  x: <XIcon />,
  refresh: <RefreshIcon />,
  coins: <CoinsIcon />,
};

export default iconsMap;
