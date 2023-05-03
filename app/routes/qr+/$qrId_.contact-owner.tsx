import { Form } from "@remix-run/react";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared";

export default function ContactOwner() {
  return (
    <div>
      Contact owner
      <Form method="post">
        <Input label="Your email" type="email" name="email" />
        <Input label="message" inputType="textarea" name="email" />
        <Button>Send</Button>
      </Form>
    </div>
  );
}
