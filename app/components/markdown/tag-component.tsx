import { Tag } from "~/components/shared/tag";

export function TagComponent({ name }: { name: string }) {
  return <Tag title={name}>{name}</Tag>;
}
