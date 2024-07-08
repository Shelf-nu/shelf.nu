export interface HorizontalTabsProps {
  items: Item[];
}

export interface Item {
  to: string;
  content: string;
  /** Special prop to manually manage active state */
  isActive?: (pathname: string) => boolean;
}
