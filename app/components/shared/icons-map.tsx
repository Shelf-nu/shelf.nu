import { ArchiveIcon, MailIcon, PlusIcon, TrashIcon } from "../icons/library";

/** The possible options for icons to be rendered in the button */
export type Icon = "plus" | "trash" | "archive" | "mail";

type IconsMap = {
  [key in Icon]: JSX.Element;
};

const iconsMap: IconsMap = {
  plus: <PlusIcon />,
  trash: <TrashIcon />,
  archive: <ArchiveIcon />,
  mail: <MailIcon />,
};

export default iconsMap;
