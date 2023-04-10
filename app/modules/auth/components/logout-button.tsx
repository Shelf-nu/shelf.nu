import { Form } from "@remix-run/react";
import IconHug from "~/components/icons/IconHug";
import { LogoutIcon } from "~/components/icons/library";

export function LogoutButton({ ...rest }) {
  return (
    <div {...rest}>
      <Form action="/logout" method="post">
        <button data-test-id="logout" type="submit" title="Logout">
          <IconHug size={"sm"} className="">
            <LogoutIcon />
          </IconHug>
        </button>
      </Form>
    </div>
  );
}
