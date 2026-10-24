import type { ReactNode } from "react";
import type { ColorValue } from "react-native";
import Svg, { Circle, Line, Path, Polyline, Rect } from "react-native-svg";

export type AppIconName =
  | "account"
  | "alert"
  | "back"
  | "bell"
  | "card"
  | "check"
  | "chevronRight"
  | "copy"
  | "devices"
  | "eye"
  | "eyeOff"
  | "history"
  | "home"
  | "lock"
  | "logout"
  | "menu"
  | "profile"
  | "qr"
  | "savings"
  | "scan"
  | "shield"
  | "transfer"
  | "users";

type AppIconProps = {
  name: AppIconName;
  size?: number;
  color?: ColorValue;
  strokeWidth?: number;
};

function getIcon(name: AppIconName): ReactNode {
  switch (name) {
    case "home":
      return <><Path d="M3.5 10.5 12 3.8l8.5 6.7" /><Path d="M5.8 9.3V20h12.4V9.3" /><Path d="M9.2 20v-6.4h5.6V20" /></>;
    case "card":
      return <><Rect x="2.8" y="5" width="18.4" height="14" rx="2.5" /><Line x1="3" y1="9.4" x2="21" y2="9.4" /><Line x1="6.5" y1="15.2" x2="10.5" y2="15.2" /></>;
    case "qr":
      return <><Rect x="3" y="3" width="6" height="6" rx="1" /><Rect x="15" y="3" width="6" height="6" rx="1" /><Rect x="3" y="15" width="6" height="6" rx="1" /><Path d="M15 15h2.5v2.5H15zM18.5 18.5H21V21h-2.5zM18.5 13.5H21V16M13.5 18.5V21H16" /></>;
    case "profile":
      return <><Circle cx="12" cy="8" r="3.5" /><Path d="M4.8 20c.8-4 3.2-6 7.2-6s6.4 2 7.2 6" /></>;
    case "bell":
      return <><Path d="M18 9.5a6 6 0 0 0-12 0c0 7-2.5 7-2.5 8.5h17C20.5 16.5 18 16.5 18 9.5Z" /><Path d="M9.5 21h5" /></>;
    case "menu":
      return <><Line x1="4" y1="7" x2="20" y2="7" /><Line x1="4" y1="12" x2="20" y2="12" /><Line x1="4" y1="17" x2="20" y2="17" /></>;
    case "eye":
      return <><Path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><Circle cx="12" cy="12" r="2.7" /></>;
    case "eyeOff":
      return <><Path d="M3 3l18 18" /><Path d="M10.2 6.2A9.7 9.7 0 0 1 12 6c6 0 9.5 6 9.5 6a15 15 0 0 1-2.3 3" /><Path d="M6.4 7.3A15.7 15.7 0 0 0 2.5 12s3.5 6 9.5 6a9.7 9.7 0 0 0 3-.5" /></>;
    case "copy":
      return <><Rect x="8" y="8" width="11" height="11" rx="2" /><Path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>;
    case "transfer":
      return <><Path d="M5 7h13" /><Polyline points="14,3 18,7 14,11" /><Path d="M19 17H6" /><Polyline points="10,13 6,17 10,21" /></>;
    case "savings":
      return <><Path d="M4 10.5h16v9H4z" /><Path d="M3 10.5 12 4l9 6.5" /><Line x1="8" y1="14" x2="8" y2="17" /><Line x1="12" y1="14" x2="12" y2="17" /><Line x1="16" y1="14" x2="16" y2="17" /></>;
    case "chevronRight":
      return <Polyline points="9,5 16,12 9,19" />;
    case "back":
      return <><Polyline points="15,5 8,12 15,19" /><Line x1="8" y1="12" x2="21" y2="12" /></>;
    case "history":
      return <><Path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" /><Polyline points="3,3 3,8 8,8" /><Path d="M12 7v5l3 2" /></>;
    case "shield":
      return <><Path d="M12 3 5 6v5c0 4.7 2.6 8 7 10 4.4-2 7-5.3 7-10V6l-7-3Z" /><Polyline points="9,12 11,14 15.5,9.5" /></>;
    case "users":
      return <><Circle cx="9" cy="8" r="3" /><Path d="M3.5 19c.6-3.7 2.5-5.5 5.5-5.5s5 1.8 5.5 5.5" /><Path d="M15 5.5a3 3 0 0 1 0 5.5M16 14c2.5.5 4 2.2 4.5 5" /></>;
    case "logout":
      return <><Path d="M10 4H5v16h5" /><Path d="M14 8l4 4-4 4" /><Line x1="18" y1="12" x2="9" y2="12" /></>;
    case "devices":
      return <><Rect x="3" y="5" width="13" height="10" rx="2" /><Path d="M7 19h5M9.5 15v4" /><Rect x="17" y="9" width="4" height="10" rx="1" /></>;
    case "lock":
      return <><Rect x="4.5" y="10" width="15" height="11" rx="2.5" /><Path d="M8 10V7a4 4 0 0 1 8 0v3" /><Circle cx="12" cy="15.5" r="1" /></>;
    case "scan":
      return <><Path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" /><Line x1="4" y1="12" x2="20" y2="12" /></>;
    case "account":
      return <><Circle cx="12" cy="12" r="9" /><Path d="M8 10h8M8 14h5" /></>;
    case "check":
      return <Polyline points="4,12 9.5,17.5 20,6.5" />;
    case "alert":
      return <><Path d="M12 3 2.8 20h18.4L12 3Z" /><Line x1="12" y1="9" x2="12" y2="14" /><Circle cx="12" cy="17" r=".6" /></>;
  }
}

export function AppIcon({
  name,
  size = 24,
  color = "#101828",
  strokeWidth = 1.8,
}: AppIconProps) {
  return (
    <Svg
      aria-hidden={true}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {getIcon(name)}
    </Svg>
  );
}
