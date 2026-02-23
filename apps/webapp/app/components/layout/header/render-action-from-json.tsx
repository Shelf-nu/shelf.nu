import type { ComponentType } from "react";
import { Button } from "~/components/shared/button";
import type { Action } from "./types";

/** Map of the possible components to be used in actions. */
const componentMap: {
  [key: string]: ComponentType<any>;
} = {
  Button,
};

export function renderActionFromJson(data: Action) {
  const componentType = data.component;
  const Component = componentMap[componentType];
  return (
    <Component key={data.children} {...data.props}>
      {data.children}
    </Component>
  );
}
