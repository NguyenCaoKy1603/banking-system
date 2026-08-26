import { ADMIN_PERMISSIONS, ADMIN_ROUTES, ADMIN_ROLES, ROLE_PERMISSIONS, assertAdminRouteRegistry } from "../src/admin/authorization/permissionRegistry.js";

assertAdminRouteRegistry();
if (new Set(ADMIN_PERMISSIONS).size !== ADMIN_PERMISSIONS.length) throw new Error("Admin permission registry contains duplicates.");
for (const role of ADMIN_ROLES) if (!ROLE_PERMISSIONS[role]?.size) throw new Error(`Admin role ${role} has no permissions.`);
for (const route of ADMIN_ROUTES) {
  if (route.stateChanging && route.path.startsWith("/admin/") && !route.path.startsWith("/admin/auth/") && !route.path.startsWith("/admin/me/") && !route.permission) throw new Error(`${route.method} ${route.path} has no permission (deny-by-default validator).`);
}
console.log(`Admin authorization contract valid: ${ADMIN_ROUTES.length} routes, ${ADMIN_PERMISSIONS.length} permissions, ${ADMIN_ROLES.length} roles.`);
