import {
  json,
  unstable_createMemoryUploadHandler,
  unstable_parseMultipartFormData,
} from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form } from "@remix-run/react";
import { useAtom } from "jotai";
import { useZorm } from "react-zorm";
import invariant from "tiny-invariant";
import { z } from "zod";
import { defaultValidateFileAtom } from "~/atoms/file";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import { useDisabled } from "~/hooks/use-disabled";
import { generateLocationWithImages } from "~/modules/location/service.server";
import { DEFAULT_MAX_IMAGE_UPLOAD_SIZE } from "~/utils/constants";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { data, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requireAdmin, requirePermission } from "~/utils/roles.server";

const GenerateLocationSchema = z.object({
  numberOfLocations: z.coerce.number().min(1).max(500).default(100),
  image: z.instanceof(File, { message: "Image is required" }),
});

export async function loader({ context }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    await requireAdmin(userId);
    return json(data(null));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
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

    const clonedRequest = request.clone();

    const { numberOfLocations } = parseData(
      await clonedRequest.formData(),
      GenerateLocationSchema.omit({ image: true })
    );

    const formDataFile = await unstable_parseMultipartFormData(
      request,
      unstable_createMemoryUploadHandler({
        maxPartSize: DEFAULT_MAX_IMAGE_UPLOAD_SIZE,
      })
    );

    const image = formDataFile.get("image") as File | null;
    invariant(image instanceof File, "file not the right type");

    if (image.size === 0) {
      throw new ShelfError({
        cause: null,
        message: "Image is required",
        status: 400,
        label: "Admin dashboard",
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

    return json(data(null));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
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
          accept="image/png, image/jpeg, image/jpg"
        />

        <Button disabled={disabled}>Create</Button>
      </Form>
    </div>
  );
}
