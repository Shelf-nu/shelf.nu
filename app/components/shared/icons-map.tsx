import { ArchiveIcon, PlusIcon, TrashIcon } from "../icons/library"
import type { ButtonIcon } from "../layout/header/types"

type IconsMap = {
	[key in ButtonIcon]: JSX.Element;
}

const iconsMap: IconsMap = {
	plus: <PlusIcon />,
	trash: <TrashIcon />,
	archive: <ArchiveIcon />,
}

export default iconsMap