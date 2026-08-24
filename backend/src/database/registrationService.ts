import { randomUUID } from "node:crypto";

import { UnitOfWork } from "./unitOfWork.js";
import { RelationalConflictError, RelationalNotFoundError } from "./commandErrors.js";
import { AccountRepository } from "./repositories/accountRepository.js";
import { AuditRepository } from "./repositories/auditRepository.js";
import { CustomerRepository } from "./repositories/customerRepository.js";
import { OutboxRepository } from "./repositories/outboxRepository.js";

export type RegistrationCommandInput = {
  pendingRegistrationId: string;
  customerId?: string;
  accountId?: string;
  traceId?: string;
};

/** Atomic registration cutover primitive for the normalized identity tables. */
export class RelationalRegistrationService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async complete(input: RegistrationCommandInput): Promise<{ customerId: string; accountId: string }> {
    return this.unitOfWork.transaction(async ({ client }) => {
      const customers = new CustomerRepository(client);
      const accounts = new AccountRepository(client);
      const audit = new AuditRepository(client);
      const outbox = new OutboxRepository(client);
      const pending = await customers.lockPendingRegistration(input.pendingRegistrationId);
      if (!pending) {
        const completed = await client.query(
          `SELECT customer_id, account_id FROM registration_completions
           WHERE pending_registration_id = $1`,
          [input.pendingRegistrationId],
        );
        if (completed.rows[0]) {
          return {
            customerId: String(completed.rows[0].customer_id),
            accountId: String(completed.rows[0].account_id),
          };
        }
        throw new RelationalNotFoundError("Pending registration not found.");
      }
      if (new Date(String(pending.expires_at)).getTime() <= Date.now()) {
        throw new RelationalConflictError("REGISTRATION_EXPIRED", "Registration challenge has expired.");
      }

      const customerId = input.customerId ?? randomUUID();
      const accountId = input.accountId ?? randomUUID();
      const customer = await customers.createCustomer({
        id: customerId,
        fullName: String(pending.full_name),
        email: String(pending.email),
        phoneNumber: String(pending.phone_number),
        passwordSalt: String(pending.password_salt),
        passwordDigest: String(pending.password_digest),
      });
      const account = await accounts.createForCustomer({
        id: accountId,
        customerId: customer.id,
      });
      await client.query(
        `INSERT INTO registration_completions
          (pending_registration_id, customer_id, account_id)
         VALUES ($1, $2, $3)`,
        [input.pendingRegistrationId, customer.id, account.id],
      );
      if (!(await customers.consumePendingRegistration(input.pendingRegistrationId))) {
        throw new RelationalConflictError("REGISTRATION_ALREADY_CONSUMED", "Registration challenge was already consumed.");
      }
      const now = new Date().toISOString();
      await audit.append({
        id: randomUUID(),
        eventType: "CUSTOMER_REGISTERED",
        actorCustomerId: customer.id,
        resourceId: account.id,
        occurredAt: now,
        payload: { traceId: input.traceId ?? null },
      });
      await outbox.append({
        id: randomUUID(),
        eventType: "CUSTOMER_REGISTERED",
        aggregateId: customer.id,
        deduplicationKey: `CUSTOMER_REGISTERED:${customer.id}`,
        occurredAt: now,
        traceId: input.traceId,
        payload: { customerId: customer.id, accountId: account.id },
      });
      return { customerId: customer.id, accountId: account.id };
    }, { traceId: input.traceId, maxRetries: 1 });
  }
}
