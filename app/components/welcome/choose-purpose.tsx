import { useState } from "react";
import { useNavigation } from "@remix-run/react";
import { config } from "~/config/shelf.config";
import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import Icon from "../icons/icon";
import { CheckmarkIcon } from "../icons/library";
import { ShelfSymbolLogo } from "../marketing/logos";
import { Button } from "../shared/button";

export function ChoosePurpose() {
  const [selectedPlan, setSelectedPlan] = useState<"personal" | "team" | null>(
    null
  );
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state) || !selectedPlan;
  return (
    <>
      <div className="flex flex-col items-center p-4 sm:p-6">
        <ShelfSymbolLogo className="mb-4 size-8" />
        <div className="mb-8 text-center">
          <h3>How will you use shelf?</h3>
          <p>
            This will give us important insights on what how to improve our
            product and what to offer.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <PlanBox
            plan="personal"
            selectedPlan={selectedPlan}
            setSelectedPlan={setSelectedPlan}
          >
            <div className="bg-primary-100 inline-flex items-center justify-center rounded-full border-[5px] border-solid border-primary-50 p-1.5 text-primary">
              <Icon icon="profile" />
            </div>
            <div>
              <h5 className="font-medium">Personal</h5>
              <p>
                I want to use Shelf for personal use and/or discover if Shelf
                offers the features I need for my workflow.
              </p>
            </div>
          </PlanBox>
          <PlanBox
            plan="team"
            selectedPlan={selectedPlan}
            setSelectedPlan={setSelectedPlan}
          >
            <div className="bg-primary-100 inline-flex items-center justify-center rounded-full border-[5px] border-solid border-primary-50 p-1.5 text-primary">
              <Icon icon="profile" />
            </div>
            <div>
              <h5 className="font-medium">Team</h5>
              <p>
                I am planning on using Shelf within a team. Multiple user will
                be accessing my workspace and they’ll be managing and/or
                interacting with the asset inventory.
              </p>
              <div className="mt-3 flex flex-col gap-4 md:flex-row">
                <div className="flex items-center gap-3">
                  <span className="text-primary">
                    <CheckmarkIcon />
                  </span>{" "}
                  <span>Free {config.freeTrialDays}-day trial</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-primary">
                    <CheckmarkIcon />
                  </span>{" "}
                  No credit card required
                </div>
              </div>
            </div>
          </PlanBox>
        </div>
        <Button
          to={selectedPlan === "team" ? "/select-plan" : "/assets/new"}
          width="full"
          className="mt-8"
          disabled={disabled}
        >
          {selectedPlan === "team"
            ? "Next: Select a plan"
            : "Create your first asset"}
        </Button>
      </div>
    </>
  );
}

const PlanBox = ({
  children,
  plan,
  selectedPlan,
  setSelectedPlan,
}: {
  plan: "personal" | "team";
  children: React.ReactNode;
  selectedPlan: "personal" | "team" | null;
  setSelectedPlan: (plan: "personal" | "team") => void;
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const selected = selectedPlan === plan;
  const activeClasses =
    "border-primary bg-primary-50 text-primary-700 [&_h5]:!text-primary-800";
  return (
    <div
      onClick={() => setSelectedPlan(plan)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={tw(
        "flex items-start gap-4 rounded border p-4 transition-colors hover:cursor-pointer",
        selected || isHovered ? activeClasses : ""
      )}
    >
      {children}
    </div>
  );
};
