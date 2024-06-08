import { useSubmit } from '@remix-run/react';
import type { z } from 'zod';

/**
 * Custom hook to handle form submission with error scrolling.
 *
 * @param schema - The Zod schema.
 * @returns A function to handle form submission.
 */
const useHandleSubmit = <T extends z.ZodTypeAny>(
  schema: T,
  formType: string
): ((event: React.FormEvent<HTMLFormElement>) => void) => {
  const submit = useSubmit();

  if (!formType) {
    throw new Error('useHandleSubmit: formType is required');
  }

  /**
   * Handles form submission.
   *
   * @param event - The form submission event.
   */
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {

    const formData = new FormData(event.currentTarget);

    const formValues = Object.fromEntries(formData.entries());

    const result = schema.safeParse(formValues);

    if (!result.success) {
      const errorMap = result.error.flatten();
      // Find the first field with an error
      const firstErrorInput = Object.keys(errorMap.fieldErrors).find(
        field => errorMap.fieldErrors[field] && errorMap.fieldErrors[field]!.length > 0
      );

      if (firstErrorInput) {
        event.preventDefault();
        const firstErrorInputElement = document.getElementById(`${formType}_${String(firstErrorInput)}`) as HTMLInputElement | null;
        if (firstErrorInputElement) {
          firstErrorInputElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
          firstErrorInputElement.focus();
          return;
        }
      }
    }
    submit(event.currentTarget);
  };
  return handleSubmit;
};

export default useHandleSubmit;
