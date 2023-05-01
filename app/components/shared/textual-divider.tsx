import { tw } from "~/utils";

interface Props {
  text: string;
  className?: string;
}

const TextualDivider = ({ text, className }: Props) => (
  <div className={tw("overflow-hidden text-center", className)}>
    <span className="relative px-2 font-medium text-gray-600 before:absolute before:right-[100%] before:top-[50%] before:h-[1px] before:w-screen before:translate-y-1/2  before:bg-gray-200 before:content-['']  after:absolute after:left-[100%] after:top-[50%] after:h-[1px] after:w-screen after:translate-y-1/2  after:bg-gray-200 after:content-['']">
      {text}
    </span>
  </div>
);

export default TextualDivider;
