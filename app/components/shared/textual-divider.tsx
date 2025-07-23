import { tw } from "~/utils/tw";

interface Props {
  text: string;
  className?: string;
}

const TextualDivider = ({ text, className }: Props) => (
  <div className={tw("overflow-hidden text-center", className)}>
    <span className="relative px-2 font-medium text-color-600 before:absolute before:right-full before:top-1/2 before:h-px before:w-screen before:translate-y-1/2  before:bg-color-200 before:content-['']  after:absolute after:left-full after:top-1/2 after:h-px after:w-screen after:translate-y-1/2  after:bg-color-200 after:content-['']">
      {text}
    </span>
  </div>
);

export default TextualDivider;
