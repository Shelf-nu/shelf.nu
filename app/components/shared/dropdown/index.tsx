import { Menu } from "@headlessui/react";
import { tw } from "~/utils";

interface Props {
  /** Title to be shown on the dropdown */
  title: string;

  /** Classes to extend the functionality */
  className?: string;

  items: { title: string; to: string }[];
}

export default function Dropdown({ title, className = "", items }: Props) {
  const hasItems = items?.length > 0;

  const styles = tw("dropdown", className);

  return hasItems ? (
    <div className={styles}>
      <Menu>
        <Menu.Button className="button">{title}</Menu.Button>
        <Menu.Items className="items">
          {items.map((item) => (
            <Menu.Item key={item.title}>
              <a className="item" href={item.to}>
                {item.title}
              </a>
            </Menu.Item>
          ))}
        </Menu.Items>
      </Menu>
    </div>
  ) : null;
}
