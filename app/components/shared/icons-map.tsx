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
  PartialCheckboxIcon,
  AssetLabel,
  LockIcon,
  ActiveSwitchIcon,
  MapIcon,
  ToolIcon,
  InstallIcon,
} from "../icons/library";

/** The possible options for icons to be rendered in the button */
export type IconType =
  | "check"
  | "map"
  | "plus"
  | "trash"
  | "archive"
  | "mail"
  | "search"
  | "spinner"
  | "x"
  | "cancel"
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
  | "assign-custody"
  | "release-custody"
  | "partial-checkbox"
  | "asset-label"
  | "lock"
  | "activate"
  | "deactivate"
  | "tool"
  | "install";

type IconsMap = {
  [key in IconType]: JSX.Element;
};

export const iconsMap: IconsMap = {
  check: <CheckIcon />,
  map: <MapIcon />,
  plus: <PlusIcon />,
  trash: <TrashIcon />,
  archive: <ArchiveIcon />,
  mail: <MailIcon />,
  search: <SearchIcon />,
  spinner: <Spinner />,
  x: <XIcon />,
  cancel: <XIcon />,
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
  "assign-custody": <CheckOutIcon />,
  "release-custody": <CheckInIcon />,
  "partial-checkbox": <PartialCheckboxIcon />,
  "asset-label": <AssetLabel />,
  lock: <LockIcon />,
  activate: <ActiveSwitchIcon />,
  deactivate: <XIcon />,
  tool: <ToolIcon />,
  install: <InstallIcon />,
};

export default iconsMap;
