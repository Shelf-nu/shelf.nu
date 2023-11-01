import type { Category } from "@prisma/client";

export const defaultUserCategories: Pick<
  Category,
  "name" | "description" | "color"
>[] = [
  {
    name: "Office Equipment",
    description:
      "Items that are used for office work, such as computers, printers, scanners, phones, etc.",
    color: "#ab339f",
  },
  {
    name: "Cables",
    description:
      "Wires that connect devices or transmit signals, such as power cords, ethernet cables, HDMI cables, etc.",
    color: "#0dec5d",
  },
  {
    name: "Machinery",
    description:
      "Equipment that performs mechanical tasks, such as drills, saws, lathes, etc.",
    color: "#efa578",
  },
  {
    name: "Inventory",
    description:
      "Goods that are stored or sold by a business, such as raw materials, finished products, spare parts, etc.",
    color: "#376dd8",
  },
  {
    name: "Furniture",
    description:
      "Items that are used for sitting, working, or storing things, such as chairs, desks, shelves, cabinets, etc.",
    color: "#88a59e",
  },
  {
    name: "Supplies",
    description:
      "Items that are consumed or used up in a process, such as paper, ink, pens, tools, etc.",
    color: "#acbf01",
  },
  {
    name: "Other",
    description: "Any other items that do not fit into the above categories.",
    color: "#48ecfc",
  },
];
