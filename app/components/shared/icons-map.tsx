import { CalendarIcon, RowsIcon } from "@radix-ui/react-icons";
import { CalendarCheck, MousePointerClick, QrCode } from "lucide-react";
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
  NoPermissionsIcon,
  ActiveSwitchIcon,
  ScanIcon,
  MapIcon,
  ToolIcon,
  AddTagsIcon,
  RemoveTagsIcon,
  InstallIcon,
  ColumnsIcon,
  LockIcon,
  ImageIcon,
  FilterIcon,
  SortIcon,
  AvailableIcon,
  UnavailableIcon,
  ChangeIcon,
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
  | "tag-remove"
  | "tag-add"
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
  | "scan"
  | "tool"
  | "rows"
  | "install"
  | "columns"
  | "no-permissions"
  | "image"
  | "filter"
  | "sort"
  | "available"
  | "unavailable"
  | "change"
  | "booking-exist"
  | "download-qr"
  | "qr-code"
  | "mouse-pointer-click";

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
  "tag-add": <AddTagsIcon />,
  "tag-remove": <RemoveTagsIcon />,
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
  "no-permissions": <NoPermissionsIcon />,
  activate: <ActiveSwitchIcon />,
  deactivate: <XIcon />,
  scan: <ScanIcon />,
  tool: <ToolIcon />,
  rows: <RowsIcon />,
  install: <InstallIcon />,
  columns: <ColumnsIcon />,
  lock: <LockIcon />,
  image: <ImageIcon />,
  filter: <FilterIcon />,
  sort: <SortIcon />,
  available: <AvailableIcon />,
  unavailable: <UnavailableIcon />,
  change: <ChangeIcon />,
  "booking-exist": <CalendarCheck />,
  "download-qr": <DownloadIcon />,
  "qr-code": <QrCode />,
  "mouse-pointer-click": <MousePointerClick />,
};

export default iconsMap;
