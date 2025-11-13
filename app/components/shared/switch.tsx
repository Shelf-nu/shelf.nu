import type { ReactElement } from "react";
import { isValidElement, createElement } from "react";
import * as React from "react";

interface SwitchChild {
  when?: boolean;
}

export const Switch = ({ children }: { children: React.ReactNode }) => {
  const components = React.Children.toArray(children);

  // Check if components[] has a non-ReactNode type Element
  const hasInvalidComponent: boolean =
    components.findIndex((component) => !isValidElement(component)) !== -1;

  // last element in components[]
  const lastComponent = components[components.length - 1];

  // Check if last component is default component - No when props
  const lastComponentIsDefault =
    isValidElement<Record<string, unknown>>(lastComponent) &&
    !("when" in lastComponent.props);

  if (hasInvalidComponent) {
    console.warn(
      "Children of <Switch /> component should be a type of ReactNode"
    );
  }

  // Filter components by the value of the 'when' props or path
  const filteredComponent = components.find(
    (component) =>
      isValidElement<SwitchChild>(component) && component.props.when
  ) as ReactElement<SwitchChild>;

  // Render filteredComponents
  if (filteredComponent) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { when, ...props } = filteredComponent.props;
    return createElement(filteredComponent.type, { ...props });
  }

  // render last component if it's diffult component (without when props);
  if (lastComponentIsDefault) return <>{lastComponent}</>;

  // Return `null` if none of the children have matched.
  return null;
};
