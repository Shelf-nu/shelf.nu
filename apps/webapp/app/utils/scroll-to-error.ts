import type { FormEvent } from "react";

/**
 * Scrolls the first field error message in `form` into view on the next frame.
 *
 * Call it from a form's `onSubmit` when `event.defaultPrevented` is set. Zorm's
 * submit listener is attached to the form element, so it runs before React's
 * delegated `onSubmit` and has already cancelled a submit that fails client
 * validation. The messages it produces are rendered after the handler returns,
 * which is why the lookup waits a frame.
 *
 * Calling it only from `onSubmit`, never from an effect on `zo.validation`,
 * matters: after the first submit Zorm re-validates on every `change` event,
 * and scrolling on each of those pulls the page away from the field being
 * edited.
 *
 * @param form - The form whose `.text-error-500` messages are searched
 */
export function scrollToFirstErrorOnNextFrame(form: HTMLFormElement) {
  requestAnimationFrame(() => {
    form
      .querySelector(".text-error-500")
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

export const scrollToError = (event: FormEvent<HTMLFormElement>) => {
  const form = event.currentTarget;
  const errorElements = form.querySelectorAll(".text-error-500");
  const yOffset = -100; // negative value will move the scroll up

  // Iterate through each error element and scroll to the first one not visible
  for (const errorElement of errorElements) {
    const elementToScrollTo =
      errorElement.previousElementSibling || errorElement;

    // Check if the element is already in the viewport
    const rect = elementToScrollTo.getBoundingClientRect();
    const isVisible =
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <=
        (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth);
    // If the element is not visible, scroll to it
    if (!isVisible) {
      const y = rect.top + window.scrollY + yOffset;
      const main = document.querySelector("main");
      if (main) {
        main.scrollTo({
          top: y,
          behavior: "smooth",
        });
      }
      break;
    }
  }
};
