import { useEffect, useState } from "react";
import type { NavTab } from "./types";

export type RouteState = {
  tab: NavTab;
  param?: string;
  subtab?: string;
};

export function parseHash(hash: string): RouteState {
  const clean = hash.replace(/^#\/?/, "");
  if (!clean) return { tab: "overview" };

  const parts = clean.split("/");
  const primary = parts[0]?.toLowerCase();

  switch (primary) {
    case "approvals":
      return { tab: "approvals", param: parts[1] };
    case "customers":
      return { tab: "customers", param: parts[1] };
    case "kyc":
      return { tab: "kyc", param: parts[1] };
    case "credit":
      return { tab: "credit", param: parts[1] };
    case "applications":
      return { tab: "kyc", subtab: parts[1] === "credit" ? "credit" : "kyc", param: parts[2] };
    case "transfers":
      return { tab: "transfers", param: parts[1] };
    case "fraud":
      return { tab: "fraud", param: parts[1] };
    case "operations":
      return { tab: "operations", param: parts[1] };
    case "staff":
      return { tab: "staff", param: parts[1] };
    case "audit":
      return { tab: "audit", param: parts[1] };
    case "overview":
    default:
      return { tab: "overview" };
  }
}

export function useRouter() {
  const [route, setRoute] = useState<RouteState>(() => parseHash(window.location.hash));

  useEffect(() => {
    const handleHashChange = () => {
      setRoute(parseHash(window.location.hash));
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const navigate = (tab: NavTab, param?: string, subtab?: string) => {
    let hash = `#/${tab}`;
    if (subtab) hash += `/${subtab}`;
    if (param) hash += `/${param}`;
    window.location.hash = hash;
  };

  return {
    route,
    navigate,
    tab: route.tab,
    param: route.param,
    subtab: route.subtab,
  };
}
