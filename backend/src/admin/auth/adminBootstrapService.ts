import { randomUUID } from "node:crypto";

import { StaffAuthService } from "./staffAuthService.js";
import type { AdminInvitationDeliveryPort } from "./adminInvitationProvider.js";
import { validateAdminInvitationActivationUrl } from "./adminInvitationProvider.js";
import type { AdminRole } from "../authorization/permissionRegistry.js";
import type { AdminRepository } from "../repositories/adminRepository.js";

export type AdminBootstrapStaffInput = {
  email: string;
  employeeCode: string;
  displayName: string;
  role: Extract<AdminRole, "ADMIN" | "CONTROL">;
};

export type AdminBootstrapServiceOptions = {
  repository: AdminRepository;
  auth: StaffAuthService;
  delivery: AdminInvitationDeliveryPort;
  activationUrl: string;
  isProductionLike: boolean;
  reservedBy?: string;
  staff: readonly [AdminBootstrapStaffInput, AdminBootstrapStaffInput];
};

export type AdminBootstrapResult = {
  event: "admin_bootstrap_completed";
  invitations: Array<{ inviteId: string; role: AdminRole; expiresAt: string; providerMessageId?: string }>;
};

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertDistinctStaff(staff: readonly [AdminBootstrapStaffInput, AdminBootstrapStaffInput]): void {
  if (normalizedEmail(staff[0].email) === normalizedEmail(staff[1].email)) {
    throw new Error("Admin bootstrap requires two different staff email addresses.");
  }
}

/**
 * Coordinates the one-time bootstrap without ever returning or persisting an
 * invitation token. A failed delivery burns every invite created by this run
 * and releases the reservation, making a later retry safe.
 */
export class AdminBootstrapService {
  private readonly activationUrl: string;
  private readonly reservedBy: string;

  constructor(private readonly options: AdminBootstrapServiceOptions) {
    assertDistinctStaff(options.staff);
    this.activationUrl = validateAdminInvitationActivationUrl(options.activationUrl, options.isProductionLike);
    this.reservedBy = options.reservedBy ?? `bootstrap:${process.pid}`;
  }

  async run(): Promise<AdminBootstrapResult> {
    const existing = (await this.options.repository.listStaff()).filter((staff) => staff.status !== "DISABLED");
    if (existing.length > 0) throw new Error("Admin bootstrap has already been completed or active staff already exists.");

    await this.options.repository.reserveBootstrap(this.reservedBy);
    const inviteIds: string[] = [];
    const invitations: AdminBootstrapResult["invitations"] = [];
    try {
      const confirmedExisting = (await this.options.repository.listStaff()).filter((staff) => staff.status !== "DISABLED");
      if (confirmedExisting.length > 0) throw new Error("Admin bootstrap has already been completed or active staff already exists.");

      for (const staff of this.options.staff) {
        const invite = await this.options.auth.invite({
          email: staff.email,
          employeeCode: staff.employeeCode,
          displayName: staff.displayName,
          role: staff.role,
          createdByStaffId: null,
        });
        inviteIds.push(invite.inviteId);
        const delivery = await this.options.delivery.send({
          deliveryId: randomUUID(),
          purpose: "STAFF_INVITATION",
          destination: staff.email.trim().toLowerCase(),
          displayName: staff.displayName,
          role: staff.role,
          invitationToken: invite.token,
          activationUrl: this.activationUrl,
          expiresAt: invite.expiresAt,
        });
        if (delivery.status !== "SENT") throw new Error(`Admin invitation delivery failed (${delivery.reason}).`);
        invitations.push({ inviteId: invite.inviteId, role: staff.role, expiresAt: invite.expiresAt, ...(delivery.providerMessageId ? { providerMessageId: delivery.providerMessageId } : {}) });
      }

      await this.options.repository.completeBootstrap();
      return { event: "admin_bootstrap_completed", invitations };
    } catch (error) {
      await this.options.repository.abortBootstrap(inviteIds);
      throw error;
    }
  }
}
