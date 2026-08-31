import { createHash, randomUUID } from "node:crypto";

import { conflict, invalidRequest, notFound } from "../errors.js";
import type { Beneficiary } from "../types.js";
import { UnitOfWork } from "./unitOfWork.js";
import { AccountRepository } from "./repositories/accountRepository.js";
import { AuditRepository } from "./repositories/auditRepository.js";
import { CustomerRepository } from "./repositories/customerRepository.js";
import { TransferRepository } from "./repositories/transferRepository.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) throw invalidRequest(`${field} is invalid.`, { [field]: `${field} must be a UUID.` });
}

function publicBeneficiary(row: Record<string, unknown>): Beneficiary {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    accountHolderName: row.account_holder_name ? String(row.account_holder_name) : undefined,
    maskedAccountNumber: String(row.masked_account_number),
    bankName: String(row.bank_name),
    status: String(row.status) as Beneficiary["status"],
  };
}

function normalizeAccountNumber(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^\d{6,34}$/.test(normalized)) {
    throw invalidRequest("accountNumber must contain between 6 and 34 digits.", {
      accountNumber: "accountNumber must contain between 6 and 34 digits.",
    });
  }
  return normalized;
}

function requireDisplayName(value: unknown): string {
  const displayName = typeof value === "string" ? value.trim() : "";
  if (!displayName || displayName.length > 80) {
    throw invalidRequest("displayName is required and must be at most 80 characters.", {
      displayName: "displayName is required and must be at most 80 characters.",
    });
  }
  return displayName;
}

function maskAccountNumber(accountNumber: string): string {
  return `•••• ${accountNumber.slice(-4)}`;
}

function accountNumberFingerprint(accountNumber: string): string {
  return createHash("sha256").update(accountNumber).digest("hex");
}

/** Direct relational beneficiary boundary. Deletion is a tombstone so
 * historical quotes remain auditable while a risk block stays reversible. */
export class RelationalBeneficiaryService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async list(customerId: string): Promise<Beneficiary[]> {
    return this.unitOfWork.transaction(async ({ client }) => {
      const rows = await new TransferRepository(client).listBeneficiaries(customerId);
      return rows.map(publicBeneficiary);
    });
  }

  async get(customerId: string, beneficiaryId: string): Promise<Beneficiary> {
    assertUuid(beneficiaryId, "beneficiaryId");
    return this.unitOfWork.transaction(async ({ client }) => {
      const row = await new TransferRepository(client).findOwnedBeneficiary(customerId, beneficiaryId);
      if (!row) throw notFound("Beneficiary not found.");
      return publicBeneficiary(row);
    });
  }

  async create(customerId: string, input: { displayName: unknown; accountNumber: unknown }): Promise<Beneficiary> {
    const displayName = requireDisplayName(input.displayName);
    const accountNumber = normalizeAccountNumber(input.accountNumber);
    return this.unitOfWork.transaction(async ({ client }) => {
      const accounts = new AccountRepository(client);
      const target = await accounts.findByAccountNumber(accountNumber);
      if (!target) throw notFound("Recipient account not found.");
      if (target.customerId === customerId) throw conflict("Cannot save your own account as a beneficiary.");
      if (target.status !== "ACTIVE") throw conflict("The recipient account is not active.");
      const owner = await new CustomerRepository(client).findCustomerById(target.customerId);
      if (!owner) throw notFound("Recipient owner not found.");
      const fingerprint = accountNumberFingerprint(accountNumber);
      const duplicate = await client.query(
        `SELECT id FROM beneficiaries
         WHERE customer_id = $1 AND destination_account_id = $2
           AND deleted_at IS NULL AND status <> 'DELETED'
         LIMIT 1`,
        [customerId, target.id],
      );
      if (duplicate.rows[0]) throw conflict("Beneficiary already exists.");
      const row = await new TransferRepository(client).createBeneficiary({
        id: randomUUID(),
        customerId,
        displayName,
        accountHolderName: owner.fullName,
        maskedAccountNumber: maskAccountNumber(accountNumber),
        accountNumberFingerprint: fingerprint,
        bankName: target.bankName,
        destinationAccountId: target.id,
        destinationOwnerId: target.customerId,
      });
      await new AuditRepository(client).append({
        id: randomUUID(),
        eventType: "BENEFICIARY_CREATED",
        actorCustomerId: customerId,
        resourceId: String(row.id),
      });
      return publicBeneficiary(row);
    }, { maxRetries: 1 });
  }

  async rename(customerId: string, beneficiaryId: string, displayName: unknown): Promise<Beneficiary> {
    assertUuid(beneficiaryId, "beneficiaryId");
    const normalized = requireDisplayName(displayName);
    return this.unitOfWork.transaction(async ({ client }) => {
      const row = await new TransferRepository(client).updateBeneficiaryName(customerId, beneficiaryId, normalized);
      if (!row) throw notFound("Beneficiary not found.");
      await new AuditRepository(client).append({
        id: randomUUID(),
        eventType: "BENEFICIARY_RENAMED",
        actorCustomerId: customerId,
        resourceId: beneficiaryId,
      });
      return publicBeneficiary(row);
    }, { maxRetries: 1 });
  }

  async remove(customerId: string, beneficiaryId: string): Promise<void> {
    assertUuid(beneficiaryId, "beneficiaryId");
    await this.unitOfWork.transaction(async ({ client }) => {
      const changed = await new TransferRepository(client).deleteBeneficiary(customerId, beneficiaryId);
      if (!changed) {
        const deleted = await client.query(
          `SELECT 1 FROM beneficiaries
            WHERE id = $1 AND customer_id = $2 AND status = 'DELETED'`,
          [beneficiaryId, customerId],
        );
        // Deleting an already tombstoned beneficiary is an idempotent no-op.
        if ((deleted.rowCount ?? 0) === 1) return;
        throw notFound("Beneficiary not found.");
      }
      await new AuditRepository(client).append({
        id: randomUUID(),
        eventType: "BENEFICIARY_DELETED",
        actorCustomerId: customerId,
        resourceId: beneficiaryId,
      });
    }, { maxRetries: 1 });
  }
}
