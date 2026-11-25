const EXCLUDED_ROUTES = new Set([
  "/login",
  "/register",
  "/forgot-password",
  "/recover",
  "/+not-found",
  "/_sitemap",
]);

const INTERNAL_NAVIGATION_PARAMS = new Set(["screen", "params", "not-found"]);

function collectDynamicParamNames(segments: string[]): Set<string> {
  const names = new Set<string>();
  for (const segment of segments) {
    if (segment.startsWith("[...") && segment.endsWith("]")) {
      names.add(segment.slice(4, -1).replace(/\?$/, ""));
    } else if (segment.startsWith("[") && segment.endsWith("]")) {
      names.add(segment.slice(1, -1));
    }
  }
  return names;
}

/**
 * Normalizes an active authenticated Expo Router location into a restorable href
 * so unlocking after a background timeout returns the user to their task screen
 * instead of resetting to Home. Auth and error routes are excluded.
 */
export function buildCurrentAuthenticatedHref(
  pathname: string,
  segments: string[],
  searchParams: Record<string, string | string[] | undefined>,
): string | null {
  if (!pathname || segments[0] === "(auth)" || EXCLUDED_ROUTES.has(pathname)) {
    return null;
  }

  let basePath = pathname;
  if (segments[0] === "(tabs)") {
    const tabSegment = segments[1];
    basePath = !tabSegment || tabSegment === "index" ? "/" : `/(tabs)/${tabSegment}`;
  }

  const dynamicParams = collectDynamicParamNames(segments);
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (
      value === undefined ||
      dynamicParams.has(key) ||
      INTERNAL_NAVIGATION_PARAMS.has(key)
    ) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") {
          query.append(key, item);
        }
      }
    } else if (typeof value === "string") {
      query.append(key, value);
    }
  }

  const queryString = query.toString();
  return queryString ? `${basePath}?${queryString}` : basePath;
}

/**
 * Tab destinations should replace the root `(tabs)` route rather than pushing
 * an extra stack frame; sub-screens should be pushed so Back returns to Home.
 */
export function shouldUseReplaceForRestore(href: string): boolean {
  return href === "/" || href.startsWith("/(tabs)/");
}
