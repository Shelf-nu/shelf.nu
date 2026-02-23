import { useState } from "react";
import { handleActivationKeyPress } from "~/utils/keyboard";
import type { InputProps } from "./input";
import Input from "./input";
import { EyeIcon, EyeOffIcon } from "../icons/library";

export default function PasswordInput(props: InputProps) {
  const [showPassword, setShowPassword] = useState(false);

  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword);
  };
  return (
    <div className="relative">
      <Input {...props} type={showPassword ? "text" : "password"} />
      <span
        className="absolute right-[14px] top-[35px] flex h-6 w-[20px] cursor-pointer flex-col items-end justify-center text-gray-500"
        role="button"
        tabIndex={0}
        onClick={togglePasswordVisibility}
        onKeyDown={handleActivationKeyPress(togglePasswordVisibility)}
      >
        {showPassword ? (
          <EyeOffIcon className="size-full" />
        ) : (
          <EyeIcon className="size-full" />
        )}
      </span>
    </div>
  );
}
