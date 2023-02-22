import { Menu } from "@headlessui/react";

import styles from "./styles.module.css";

interface Props {
  /** Title to be shown on the dropdown */
  title: string;

  /** Classes to extend the functionality */
  className?: string;

  items: { title: string; to: string }[];
}

export default function Dropdown({ title, className = "", items }: Props) {
  const hasItems = items?.length > 0;

  return hasItems ? (
    <div className={`dropdown-wrapper ${className} ${styles.menu}`}>
      <Menu>
        <Menu.Button className={styles.button}>{title}</Menu.Button>
        <Menu.Items className={styles.items}>
          {items.map((item) => (
            <Menu.Item key={item.title}>
              <a className={styles.item} href={item.to}>
                {item.title}
              </a>
            </Menu.Item>
          ))}
        </Menu.Items>
      </Menu>
    </div>
  ) : null;
}
