import { json } from "@remix-run/node";
import Input from "~/components/forms/input";
import { UserIcon } from "~/components/icons";
import { Button } from "~/components/shared/button";
import styles from "~/styles/layout/custom-modal.css";

export const loader = async () => {
  const showModal = true;

  return json({
    showModal,
  });
};

export function links() {
  return [{ rel: "stylesheet", href: styles }];
}

export default function AddMember() {
  return (
    <>
      <div className="modal-content-wrapper">
        <div className="mb-4 inline-flex h-8 w-8 items-center  justify-center rounded-full bg-primary-100 p-2 text-primary-600">
          <UserIcon color="#ef6820" />
        </div>
        <div className="mb-5">
          <h4>Add team member</h4>
          <p>
            Team members are added to your environment but do not have an
            account to log in with.
          </p>
        </div>
        <Input
          name="name"
          type="text"
          label="Name"
          className="mb-8"
          placeholder="Enter team member’s name"
          required
        />
        <Button variant="primary" width="full" to="..">
          Add team member
        </Button>
      </div>
    </>
  );
}
