import type { CreateAssetFromContentImportPayload } from "~/modules/asset";

/* This function receives an array of object and a key name
 * It then extracts all the values of that key and makes sure there are no duplicates
 * 	as a last step it returns an object where the key is each unique value and the value is an empty string
 * The value will later be replaced by the id of the newly created item or the id of the existing item
 */
export function getUniqueValuesFromArrayOfObjects({
  array,
  key,
}: {
  array: Array<CreateAssetFromContentImportPayload>;
  key: string;
}) {
  const items = array.reduce((acc, item) => {
    if (item[key] && item[key] !== "") {
      acc[item[key]] = "";
    }
    return acc;
  }, {} as Record<string, string>);
  return items;
}
