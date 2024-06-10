export const scrollToError = () => {
  const errorElements = document.querySelectorAll(".text-error-500");

  const observer = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          const elementToScrollTo = entry.target.previousElementSibling || entry.target;
          elementToScrollTo.scrollIntoView({ behavior: "smooth" });
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1 }
  );

  errorElements.forEach((errorElement) => {
    const elementToScrollTo = errorElement.previousElementSibling || errorElement;
    
    // Check if the element is already in the viewport
    const rect = elementToScrollTo.getBoundingClientRect();
    const isVisible = (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );

    // If the element is not visible, observe it
    if (!isVisible) {
      observer.observe(errorElement);
    }
  });

  return () => {
    observer.disconnect();
  };
};
