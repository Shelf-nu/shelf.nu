export interface HorizontalTabsProps {
  items: Item[];
  className?: string;
}

export interface Item {
  to: string;
  content: string;
  /** Special prop to manually manage active state */
  isActive?: (pathname: string) => boolean;
}
