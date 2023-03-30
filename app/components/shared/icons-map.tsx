import { Spinner } from "./spinner";

import {
  ArchiveIcon,
  MailIcon,
  PlusIcon,
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
  | "x";

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
};

export default iconsMap;
