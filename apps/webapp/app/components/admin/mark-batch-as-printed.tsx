import { useLoaderData, useNavigation } from "react-router";
import type { loader } from "~/routes/_layout+/admin-dashboard+/qrs";
import { isFormProcessing } from "~/utils/form";
import { Form } from "../custom-form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms/select";
import { Button } from "../shared/button";

export const MarkBatchAsPrinted = () => {
  const { batches } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);
  return (
    <div className="flex w-[400px] flex-col gap-2 bg-gray-200 p-4">
      <h3>Mark batch as printed</h3>
      <Form className="flex flex-col gap-2" method="post">
        <Select name={`batch`} disabled={disabled}>
          <SelectTrigger className="mt-2 px-3.5 py-2 text-left text-base text-gray-500 md:mt-0 ">
            <SelectValue placeholder={`Select batch`} />
          </SelectTrigger>
          <SelectContent
            position="popper"
            className="w-full min-w-[300px] p-0"
            align="start"
          >
            <div className=" max-h-[320px] overflow-auto">
              {batches
                .filter((b) => !b.printed)
                .map((batch) => (
                  <SelectItem
                    value={batch.id}
                    key={batch.id}
                    defaultValue={batches[0].id}
                    className="rounded-none border-b border-gray-200 px-6 py-4 pr-[5px]"
                  >
                    <span className="mr-4 block text-[14px] lowercase text-gray-700 first-letter:uppercase">
                      {batch.name}
                    </span>
                  </SelectItem>
                ))}
            </div>
          </SelectContent>
        </Select>
        <Button
          type="submit"
          variant="secondary"
          name="intent"
          value="markBatchAsPrinted"
        >
          Mark Batch as printed
        </Button>
        <p className="mt-2 text-sm text-gray-500">
          Be careful. This is a one time action that doesn't require
          confirmation
        </p>
      </Form>
    </div>
  );
};
