import { useCallback, useEffect } from "react";
import { Link, NavLink } from "@remix-run/react";
import { atom, useAtom } from "jotai";
import {
  AssetsIcon,
  ItemsIcon,
  SettingsIcon,
  PrintTagIcon,
  SwitchIcon,
  ActiveSwitchIcon,
} from "~/components/icons/library";

import type { User } from "~/database";
import { tw } from "~/utils";

import SidebarBottom from "./bottom";

interface Props {
  user: User;
}

const sidebarCollapseStatus = atom(true);
const isSidebarSwitchClicked = atom(false);

export default function Sidebar({ user }: Props) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useAtom(
    sidebarCollapseStatus
  );
  const [sidebarSwitchIsClicked, setSidebarSwitchIsClicked] = useAtom(
    isSidebarSwitchClicked
  );
  const menuItems = [
    {
      icon: <AssetsIcon />,
      to: "items",
      label: "Items",
    },
    {
      icon: <ItemsIcon />,
      to: "categories",
      label: "Categories",
    },
    {
      icon: <PrintTagIcon />,
      to: "print",
      label: "Print Tags",
    },
    {
      icon: <SettingsIcon />,
      to: "settings",
      label: "Settings",
      end: true,
    },
  ];

  const collapseSidebar = useCallback(() => {
    setIsSidebarCollapsed(true);
  }, []);
  const uncollapseSidebar = useCallback(() => {
    setIsSidebarCollapsed(false);
  }, []);

  useEffect(() => {
    if (sidebarSwitchIsClicked === false) {
      const sidebar = document.getElementById("main-navigation") as HTMLElement;
      sidebar.addEventListener("mouseenter", uncollapseSidebar);
      sidebar.addEventListener("mouseleave", collapseSidebar);
    }
  });

  function maintainUncollapsedState() {
    const sidebar = document.getElementById("main-navigation") as HTMLElement;
    if (sidebarSwitchIsClicked === false) {
      sidebar.removeEventListener("mouseenter", uncollapseSidebar);
      sidebar.removeEventListener("mouseleave", collapseSidebar);
    } else {
      sidebar.addEventListener("mouseenter", uncollapseSidebar);
      sidebar.addEventListener("mouseleave", collapseSidebar);
    }
    setSidebarSwitchIsClicked(!sidebarSwitchIsClicked);
  }

  return (
    <aside
      id="main-navigation"
      className={tw(
        `sticky top-0 flex h-screen w-80 flex-col border-r border-gray-200 px-6 py-8 transition-all duration-200 ease-linear`,
        isSidebarCollapsed ? "collapsed" : ""
      )}
    >
      <div className="navigation-header flex items-center justify-between">
        <Link to="." title="Home" className="flex items-center">
          <img
            src="/images/shelf-symbol.png"
            alt="Shelf Logo"
            className="mx-1.5 inline h-[32px]"
          />
          <span className="logo-text transition duration-200 ease-linear">
            <svg
              width="61"
              height="21"
              viewBox="0 0 61 21"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12.6464 10.4013L8.98113 10.6263C8.91827 10.312 8.78265 10.0309 8.57755 9.77614C8.37246 9.52143 8.1012 9.31964 7.76379 9.16416C7.42969 9.012 7.02943 8.93261 6.56631 8.93261C5.94441 8.93261 5.42175 9.06162 4.99833 9.32295C4.57491 9.58428 4.3599 9.9283 4.3599 10.3616C4.3599 10.7057 4.49883 10.9968 4.77339 11.235C5.04796 11.4731 5.52099 11.665 6.19251 11.8072L8.8058 12.3332C10.2084 12.621 11.2537 13.0841 11.9451 13.7225C12.6331 14.361 12.9771 15.2012 12.9771 16.2399C12.9771 17.186 12.6993 18.0163 12.1468 18.7308C11.5911 19.4453 10.8336 20.0011 9.87097 20.398C8.90835 20.795 7.80349 20.9934 6.54977 20.9934C4.63777 20.9934 3.11941 20.5932 1.98809 19.796C0.856764 18.9987 0.19517 17.9071 0 16.531L3.93648 16.3259C4.05557 16.9081 4.34336 17.3514 4.79986 17.6557C5.25636 17.96 5.84187 18.1122 6.55639 18.1122C7.27091 18.1122 7.82334 17.9766 8.25337 17.702C8.68341 17.4308 8.90174 17.0768 8.90504 16.6435C8.89843 16.2796 8.74626 15.9819 8.44524 15.747C8.14421 15.5121 7.68109 15.3335 7.05589 15.2078L4.55507 14.7083C3.14587 14.4271 2.09725 13.9376 1.4125 13.2429C0.727751 12.5482 0.383725 11.6617 0.383725 10.5833C0.383725 9.65705 0.635128 8.85652 1.14125 8.18831C1.64406 7.5168 2.35527 7.00076 3.27489 6.63688C4.19119 6.273 5.26959 6.09106 6.50346 6.09106C8.32615 6.09106 9.7618 6.4781 10.8137 7.24554C11.8624 8.0163 12.4743 9.06493 12.6497 10.3947L12.6464 10.4013Z"
                fill="#252422"
              />
              <path
                d="M18.9744 12.3729V20.7189H14.9718V1.47314H18.862V8.83006H19.0307C19.3549 7.9766 19.8841 7.3084 20.6086 6.82212C21.3363 6.33585 22.246 6.09437 23.3443 6.09437C24.3466 6.09437 25.2232 6.3127 25.9708 6.74604C26.7184 7.18269 27.3006 7.80459 27.7174 8.61504C28.1342 9.42549 28.3393 10.3947 28.3327 11.5227V20.7123H24.33V12.2373C24.3366 11.3474 24.1117 10.6561 23.6585 10.1599C23.2053 9.66367 22.5702 9.41888 21.7564 9.41888C21.2106 9.41888 20.731 9.53466 20.3142 9.76621C19.8974 9.99777 19.5732 10.3352 19.3383 10.7751C19.1034 11.2151 18.9844 11.7477 18.9777 12.3696L18.9744 12.3729Z"
                fill="#252422"
              />
              <path
                d="M37.5421 21.0001C36.0568 21.0001 34.78 20.699 33.7115 20.0937C32.643 19.4883 31.8226 18.6315 31.2438 17.5201C30.6682 16.4086 30.3804 15.092 30.3804 13.5671C30.3804 12.0421 30.6682 10.7784 31.2438 9.65704C31.8193 8.53564 32.6331 7.66234 33.6817 7.03382C34.7303 6.40862 35.9642 6.09436 37.38 6.09436C38.3327 6.09436 39.2193 6.24653 40.0429 6.55086C40.8666 6.85519 41.5878 7.31169 42.203 7.91705C42.8216 8.52571 43.3013 9.28655 43.6453 10.2062C43.9893 11.1258 44.1614 12.1976 44.1614 13.4248V14.5231H31.9715V12.0421H40.3903C40.3903 11.4665 40.2646 10.9538 40.0132 10.5105C39.7618 10.0672 39.4177 9.71658 38.9745 9.46187C38.5345 9.20716 38.0218 9.08145 37.4363 9.08145C36.8508 9.08145 36.2917 9.22039 35.8253 9.49826C35.3589 9.77613 34.995 10.1499 34.7303 10.6163C34.4657 11.0828 34.3334 11.6021 34.3268 12.1711V14.5297C34.3268 15.2442 34.4591 15.8595 34.727 16.3821C34.9917 16.9015 35.3721 17.3017 35.8584 17.5862C36.3479 17.8674 36.9268 18.0097 37.5983 18.0097C38.0416 18.0097 38.4518 17.9468 38.819 17.8211C39.1895 17.6954 39.5037 17.5068 39.7684 17.2587C40.033 17.0073 40.2315 16.6997 40.3704 16.3391H44.072C43.8835 17.2323 43.4998 18.2478 42.9209 18.9094C42.342 19.571 41.5944 20.0837 40.6847 20.4509C39.7717 20.8181 38.7231 21.0001 37.5322 21.0001H37.5421Z"
                fill="#252422"
              />
              <path
                d="M50.2546 1.47314V20.7189H46.252V1.47314H50.2546Z"
                fill="#252422"
              />
              <path
                d="M59.6889 6.28292V9.28986H52.9109V6.28292H59.6889ZM52.8182 20.7189V5.24091C52.8182 4.1956 53.0233 3.3256 53.4335 2.63755C53.8437 1.94949 54.4061 1.43014 55.1206 1.08611C55.8351 0.742082 56.6456 0.570068 57.5552 0.570068C58.1705 0.570068 58.7329 0.61638 59.2423 0.712311C59.7517 0.808242 60.1321 0.890941 60.3836 0.967024L59.669 3.97396C59.5136 3.92435 59.3184 3.87803 59.0901 3.83172C58.8619 3.78872 58.627 3.76556 58.3888 3.76556C57.8 3.76556 57.3898 3.90119 57.1583 4.17575C56.9267 4.45031 56.811 4.82742 56.811 5.317V20.7189H52.8182Z"
                fill="#252422"
              />
            </svg>
          </span>
        </Link>
        <button
          className="transition-all duration-200 ease-linear"
          onClick={maintainUncollapsedState}
        >
          <i className="icon text-gray-500">
            {sidebarSwitchIsClicked ? <ActiveSwitchIcon /> : <SwitchIcon />}
          </i>
        </button>
      </div>
      <div className="flex-1">
        <ul className="menu mt-10">
          {menuItems.map((item) => (
            <li key={item.label}>
              <NavLink
                className={({ isActive }) =>
                  tw(
                    "my-1 flex items-center gap-3 rounded-md px-3 py-2.5 text-text-md font-semibold text-gray-700 transition-all duration-75 hover:bg-gray-100 hover:text-gray-900",
                    isActive ? "bg-gray-100 text-gray-900" : ""
                  )
                }
                to={item.to}
              >
                <i className="icon text-gray-500">{item.icon}</i>
                <span className="text whitespace-nowrap transition duration-200 ease-linear">
                  {item.label}
                </span>
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-auto">
        <SidebarBottom
          user={{
            ...user,
          }}
        />
      </div>
    </aside>
  );
}
