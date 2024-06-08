export const scrollToError = () => {
  const scrollToFirstError = () => {
    const errorElements = document.querySelectorAll(".text-error-500");
    if (errorElements.length > 0) {
      let firstError = errorElements[0];
      const elementToScrollTo = firstError.previousElementSibling || firstError;
      elementToScrollTo.scrollIntoView({ behavior: "smooth" });
    }
  };

  scrollToFirstError();

  const observer = new IntersectionObserver(
    (entries, observer) => {
      const notIntersecting = entries.filter((entry) => !entry.isIntersecting);

      if (notIntersecting.length > 0) {
        notIntersecting.forEach((entry) => {
          const elementToScrollTo =
            entry.target.previousElementSibling || entry.target;
          elementToScrollTo.scrollIntoView({ behavior: "smooth" });
          observer.unobserve(entry.target);
        });
      }
    },
    { threshold: 0.1 }
  );

  return () => {
    observer.disconnect();
  };
};
