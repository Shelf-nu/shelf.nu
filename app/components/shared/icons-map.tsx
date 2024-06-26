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
  LogoutIcon,
  HelpIcon,
  Profile,
  UserIcon,
  GpsMarkerIcon,
  DuplicateIcon,
  GraphIcon,
  ScanQRIcon,
  SwitchIcon,
  KitIcon,
  BookingsIcon,
  CheckOutIcon,
  CheckInIcon,
  CheckIcon,
  AssetLabel,
} from "../icons/library";

/** The possible options for icons to be rendered in the button */
export type IconType =
  | "check"
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
  | "gps"
  | "duplicate"
  | "asset"
  | "download"
  | "print"
  | "settings"
  | "logout"
  | "help"
  | "profile"
  | "send"
  | "user"
  | "calendar"
  | "graph"
  | "scanQR"
  | "switch"
  | "kit"
  | "bookings"
  | "check-out"
  | "check-in"
  | "asset-label";

type IconsMap = {
  [key in IconType]: JSX.Element;
};

export const iconsMap: IconsMap = {
  check: <CheckIcon />,
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
  gps: <GpsMarkerIcon />,
  duplicate: <DuplicateIcon />,
  asset: <AssetsIcon />,
  download: <DownloadIcon />,
  print: <PrintIcon />,
  settings: <SettingsIcon />,
  help: <HelpIcon />,
  profile: <Profile />,
  logout: <LogoutIcon />,
  send: <SendIcon />,
  user: <UserIcon />,
  calendar: <CalendarIcon className="size-5" />,
  bookings: <BookingsIcon />,
  graph: <GraphIcon />,
  scanQR: <ScanQRIcon />,
  switch: <SwitchIcon />,
  kit: <KitIcon />,
  "check-out": <CheckOutIcon />,
  "check-in": <CheckInIcon />,
  "asset-label": <AssetLabel />,
};

export default iconsMap;
