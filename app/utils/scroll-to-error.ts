export const scrollToError = (event: React.FormEvent<HTMLFormElement>) => {
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
