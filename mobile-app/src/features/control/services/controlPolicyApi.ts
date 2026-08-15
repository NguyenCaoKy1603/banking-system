import type { RequestAuth } from "@/services/api/httpClient";
import { requestJson } from "@/services/api/httpClient";
import type { ControlPolicy } from "@/features/control/types/controlPolicy";
import { isControlPolicy } from "@/features/control/validation/controlPolicyValidators";

export function getControlPolicy(auth: RequestAuth): Promise<ControlPolicy> {
  return requestJson<ControlPolicy>(
    "/mobile/control-policy",
    { auth },
    isControlPolicy,
  );
}

export const controlPolicyApi = { getControlPolicy };
