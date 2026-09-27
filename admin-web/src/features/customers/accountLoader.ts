import { adminFetch, type ApiError } from "../../api.ts";
import type { Account, Customer } from "../../types.ts";

export interface AccountLoaderState {
  selectedCustomer: Customer | null;
  accounts: Account[];
  loading: boolean;
  error: ApiError | null;
}

export type AccountLoaderListener = (state: AccountLoaderState) => void;

/**
 * Manages customer account loading with strict generation & customer matching guards.
 * Ensures stale asynchronous responses never overwrite the active customer's state.
 */
export class AccountLoadManager {
  private activeCustomerId: string | null = null;
  private currentGenerationId = 0;
  private abortController: AbortController | null = null;
  private state: AccountLoaderState = {
    selectedCustomer: null,
    accounts: [],
    loading: false,
    error: null,
  };
  private listeners: Set<AccountLoaderListener> = new Set();

  getState(): AccountLoaderState {
    return this.state;
  }

  getCurrentGenerationId(): number {
    return this.currentGenerationId;
  }

  getActiveCustomerId(): string | null {
    return this.activeCustomerId;
  }

  subscribe(listener: AccountLoaderListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  /**
   * Resets customer selection and aborts any active loading.
   */
  clear(): void {
    this.currentGenerationId++;
    this.activeCustomerId = null;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.state = {
      selectedCustomer: null,
      accounts: [],
      loading: false,
      error: null,
    };
    this.notify();
  }

  /**
   * Loads accounts for a customer.
   * If isSwitchingCustomer is true, previous accounts are cleared immediately.
   * Only responses matching both the latest generation ID and active customer ID are accepted.
   */
  async loadCustomerAccounts(
    customer: Customer,
    isSwitchingCustomer: boolean,
    fetcher?: (customerId: string, signal: AbortSignal) => Promise<{ items: Account[] }>
  ): Promise<void> {
    // 1. Abort any previous pending request
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    const controller = new AbortController();
    this.abortController = controller;

    // 2. Increment generation ID and update active customer
    const generationId = ++this.currentGenerationId;
    this.activeCustomerId = customer.id;

    // 3. Clear previous accounts immediately if switching customer
    this.state = {
      selectedCustomer: customer,
      accounts: isSwitchingCustomer ? [] : this.state.accounts,
      loading: true,
      error: null,
    };
    this.notify();

    try {
      const fetchImpl =
        fetcher ??
        ((id: string, signal: AbortSignal) =>
          adminFetch<{ items: Account[] }>(`/admin/customers/${id}/accounts`, { signal }));

      const result = await fetchImpl(customer.id, controller.signal);

      // GUARD: Both generation ID and active customer ID must strictly match!
      if (
        generationId === this.currentGenerationId &&
        this.activeCustomerId === customer.id
      ) {
        this.state = {
          ...this.state,
          accounts: result.items,
          error: null,
        };
        this.notify();
      }
    } catch (caught) {
      const err = caught as ApiError;
      if (controller.signal.aborted || err.name === "AbortError" || err.code === "CLIENT_ABORT") {
        return;
      }
      if (
        generationId === this.currentGenerationId &&
        this.activeCustomerId === customer.id
      ) {
        this.state = {
          ...this.state,
          accounts: [],
          error: err,
        };
        this.notify();
      }
    } finally {
      if (
        generationId === this.currentGenerationId &&
        this.activeCustomerId === customer.id
      ) {
        this.state = {
          ...this.state,
          loading: false,
        };
        this.notify();
      }
    }
  }
}
