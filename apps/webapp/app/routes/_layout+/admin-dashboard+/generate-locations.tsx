import { parseFormData } from "@remix-run/form-data-parser";
import { useAtom } from "jotai";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Form } from "react-router";
import { useZorm } from "react-zorm";
import invariant from "tiny-invariant";
import { z } from "zod";
import { defaultValidateFileAtom } from "~/atoms/file";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import { useDisabled } from "~/hooks/use-disabled";
import { generateLocationWithImages } from "~/modules/location/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { DEFAULT_MAX_IMAGE_UPLOAD_SIZE } from "~/utils/constants";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { isMaxFileSizeError } from "~/utils/form-data-parse-errors.server";
import { payload, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requireAdmin, requirePermission } from "~/utils/roles.server";

const GenerateLocationSchema = z.object({
  numberOfLocations: z.coerce.number().min(1).max(500).default(100),
  image: z.instanceof(File, { message: "Image is required" }),
});
export const meta = () => [{ title: appendToMetaTitle("Generate locations") }];

export async function loader({ context }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    await requireAdmin(userId);
    return payload(null);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { userId } = context.getSession();

  try {
    await requireAdmin(userId);

    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.location,
      action: PermissionAction.create,
    });

    /**
     * One parse, and a bounded one. The parser enforces a per-file limit while
     * reading the body and defaults to 2 MiB, so it has to be told the limit this
     * route allows, or a file well inside the stated 4 MB is refused and the
     * operator is shown a captured 500 instead of the size message.
     *
     * Every field is read from the result. Reading the text fields first through
     * a clone would hand the whole upload to the native parser, which has no
     * limit at all, so the body would be held in memory in full before this
     * limit could refuse it.
     */
    let formDataFile: FormData;
    try {
      formDataFile = await parseFormData(request, {
        maxFileSize: DEFAULT_MAX_IMAGE_UPLOAD_SIZE,
      });
    } catch (parseError) {
      if (isMaxFileSizeError(parseError)) {
        throw new ShelfError({
          cause: parseError,
          message: `Image size exceeds maximum allowed size of ${
            DEFAULT_MAX_IMAGE_UPLOAD_SIZE / (1024 * 1024)
          }MB`,
          status: 400,
          label: "Admin dashboard",
          shouldBeCaptured: false,
        });
      }

      throw parseError;
    }

    const { numberOfLocations } = parseData(
      formDataFile,
      GenerateLocationSchema.omit({ image: true })
    );

    const image = formDataFile.get("image") as File | null;
    invariant(image instanceof File, "file not the right type");

    if (image.size === 0) {
      throw new ShelfError({
        cause: null,
        message: "Image is required",
        status: 400,
        label: "Admin dashboard",
        shouldBeCaptured: false,
      });
    }

    await generateLocationWithImages({
      organizationId,
      userId,
      numberOfLocations,
      image,
    });

    sendNotification({
      title: "Locations created",
      message: "Your locations have been created successfully",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return payload(null);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

export default function GenerateLocations() {
  const zo = useZorm("GenerateLocations", GenerateLocationSchema);
  const disabled = useDisabled();
  const [, validateFile] = useAtom(defaultValidateFileAtom);

  return (
    <div className="rounded-md border bg-white p-4">
      <h2>Generate locations</h2>
      <p className="mb-4">
        Generate locations for the given number of locations. This is useful for
        testing purposes.
      </p>

      <Form
        method="POST"
        ref={zo.ref}
        className="md:max-w-screen-sm"
        encType="multipart/form-data"
      >
        <Input
          className="mb-4"
          label="Number of location"
          type="number"
          min={1}
          max={500}
          required
          placeholder="Enter the number of locations you want to create"
          name={zo.fields.numberOfLocations()}
          error={zo.errors.numberOfLocations()?.message}
        />

        <Input
          className="mb-4"
          label="Image"
          type="file"
          required
          name={zo.fields.image()}
          error={zo.errors.image()?.message}
          onChange={validateFile}
          accept="image/png, image/jpeg, image/jpg, image/webp"
        />

        <Button type="submit" disabled={disabled}>
          Create
        </Button>
      </Form>
    </div>
  );
}
