import { Button } from "../shared/button";

export const CategorySelectNoCategories = () => (
  <div>
    You don't seem to have any categories yet.{" "}
    <Button to={"/categories/new"} variant="link" className="">
      Create your first category
    </Button>
  </div>
);
