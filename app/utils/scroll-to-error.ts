export const scrollToError = () => {
  const errorElements = document.querySelectorAll(".text-error-500");

  // Create an IntersectionObserver to observe visibility changes
  const observer = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        // If the element is not intersecting (not visible), scroll to it
        if (!entry.isIntersecting) {
          const elementToScrollTo =
            entry.target.previousElementSibling || entry.target;
          elementToScrollTo.scrollIntoView({ behavior: "smooth" });
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1 }
  );

  // Iterate through each error element and observe if it's not already visible
  errorElements.forEach((errorElement) => {
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

    // If the element is not visible, observe it
    if (!isVisible) {
      observer.observe(errorElement);
    }
  });

  return () => {
    observer.disconnect();
  };
};
