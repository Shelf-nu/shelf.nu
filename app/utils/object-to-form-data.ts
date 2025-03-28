/**
 * Converts a JavaScript object to FormData with special handling for specific fields
 *
 * @param obj - The object to convert to FormData
 * @param options - Configuration options
 * @returns FormData object containing all data from the input object
 */
export function objectToFormData(
  obj: Record<string, any>,
  options: {
    jsonStringifyFields?: string[]; // Fields that need to be JSON.stringify'd
    formData?: FormData;
    namespace?: string;
  } = {}
): FormData {
  const {
    jsonStringifyFields = [],
    formData = new FormData(),
    namespace = "",
  } = options;

  // Handle each property in the object
  for (const key in obj) {
    if (obj.hasOwnProperty(key) && obj[key] !== undefined) {
      // Create the property name with namespace if needed
      const formKey = namespace ? `${namespace}[${key}]` : key;

      // Check if this field needs to be JSON stringified
      if (jsonStringifyFields.includes(key)) {
        formData.append(formKey, JSON.stringify(obj[key]));
        continue;
      }

      // Handle the value based on its type
      if (obj[key] === null) {
        // Handle null values
        formData.append(formKey, "");
      } else if (
        typeof obj[key] === "object" &&
        !(obj[key] instanceof File) &&
        !(obj[key] instanceof Blob)
      ) {
        if (Array.isArray(obj[key])) {
          // Handle arrays
          if (obj[key].length === 0) {
            // For empty arrays, append a special notation
            formData.append(`${formKey}[]`, "");
          } else {
            // For non-empty arrays, append each item with array notation
            obj[key].forEach((value: any, index: number) => {
              if (typeof value === "object" && value !== null) {
                // For array of objects, use recursion with indexed namespace
                objectToFormData(value, {
                  jsonStringifyFields,
                  formData,
                  namespace: `${formKey}[${index}]`,
                });
              } else {
                // For array of primitives, use simple array notation
                formData.append(`${formKey}[${index}]`, value.toString());
              }
            });
          }
        } else {
          // Check if the parent field should be stringified
          const nestedFieldToStringify = jsonStringifyFields.find((field) =>
            field.startsWith(`${namespace ? namespace + "." : ""}${key}.`)
          );

          if (nestedFieldToStringify) {
            // If a nested field of this object needs to be stringified,
            // pass down the information in recursive call
            const remainingPath = nestedFieldToStringify.substring(
              key.length + 1
            );
            objectToFormData(obj[key], {
              jsonStringifyFields: [...jsonStringifyFields, remainingPath],
              formData,
              namespace: formKey,
            });
          } else {
            // Handle nested objects with recursion
            objectToFormData(obj[key], {
              jsonStringifyFields,
              formData,
              namespace: formKey,
            });
          }
        }
      } else {
        // Handle primitive values and Files/Blobs directly
        formData.append(formKey, obj[key].toString());
      }
    }
  }

  return formData;
}
