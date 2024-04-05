import { CalendarIcon } from "@radix-ui/react-icons";
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
  BarCodeIcon,
  PenIcon,
  HomeIcon,
  QuestionsIcon,
  WriteIcon,
  TagsIcon,
  CategoriesIcon,
  LocationMarkerIcon,
  AssetsIcon,
  DownloadIcon,
  PrintIcon,
  SettingsIcon,
  SendIcon,
  StarIcon,
  DeactivateIcon,
  PdfIcon,
  LogoutIcon,
  HelpIcon,
  Profile,
  CopyIcon,
  SignIcon,
  UserIcon,
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
  | "barcode"
  | "pen"
  | "success"
  | "home"
  | "question"
  | "write"
  | "tag"
  | "category"
  | "location"
  | "asset"
  | "download"
  | "print"
  | "settings"
  | "send"
  | "star"
  | "deactivate"
  | "pdf"
  | "logout"
  | "help"
  | "profile"
  | "send"
  | "copy"
  | "sign"
  | "user"
  | "calendar";

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
  barcode: <BarCodeIcon />,
  pen: <PenIcon />,
  success: <SuccessIcon />,
  home: <HomeIcon />,
  question: <QuestionsIcon />,
  write: <WriteIcon />,
  tag: <TagsIcon />,
  category: <CategoriesIcon />,
  location: <LocationMarkerIcon />,
  asset: <AssetsIcon />,
  download: <DownloadIcon />,
  print: <PrintIcon />,
  settings: <SettingsIcon />,
  help: <HelpIcon />,
  profile: <Profile />,
  logout: <LogoutIcon />,
  send: <SendIcon />,
  star: <StarIcon />,
  deactivate: <DeactivateIcon />,
  pdf: <PdfIcon />,
  copy: <CopyIcon />,
  sign: <SignIcon />,
  user: <UserIcon />,
  calendar: <CalendarIcon className="size-5" />,
};

export default iconsMap;
