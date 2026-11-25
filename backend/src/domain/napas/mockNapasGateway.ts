import { createHash } from "node:crypto";

import { invalidRequest, notFound } from "../../errors.js";

export type NapasBank = {
  bin: string;
  code: string;
  shortName: string;
  name: string;
};

export const NAPAS_BANKS: readonly NapasBank[] = [
  { bin: "970436", code: "VCB", shortName: "VCB", name: "Vietcombank" },
  { bin: "970407", code: "TCB", shortName: "TCB", name: "Techcombank" },
  { bin: "970422", code: "MB", shortName: "MB", name: "MB Bank" },
  { bin: "970423", code: "TPB", shortName: "TPB", name: "TPBank" },
  { bin: "970416", code: "ACB", shortName: "ACB", name: "ACB" },
  { bin: "970418", code: "BIDV", shortName: "BIDV", name: "BIDV" },
  { bin: "970415", code: "CTG", shortName: "VietinBank", name: "VietinBank" },
  { bin: "970405", code: "VBA", shortName: "Agribank", name: "Agribank" },
] as const;

const BANK_BY_BIN = new Map<string, NapasBank>(NAPAS_BANKS.map((bank) => [bank.bin, bank]));

const DETERMINISTIC_HOLDER_NAMES = [
  "NGUYEN VAN MINH",
  "TRAN THI HUONG",
  "LE HOANG NAM",
  "PHAM MINH TUAN",
  "VO THI LAN ANH",
  "HOANG QUOC BAO",
  "DOAN THANH TUNG",
  "BUI THI NGOC MAI",
] as const;

export type NapasInquiryResult = {
  bank: NapasBank;
  accountNumber: string;
  maskedAccountNumber: string;
  accountHolderName: string;
};

export type NapasSettlementRequest = {
  transferId: string;
  reference: string;
  bankBin: string;
  accountNumber: string;
  amountMinor: string;
  description: string;
};

export type NapasSettlementStatus = "SUCCEEDED" | "FAILED" | "PENDING";

export type NapasSettlementResult = {
  status: NapasSettlementStatus;
  napasTraceId: string;
  responseCode: string;
  failureReason: string | null;
};

function normalizeBankBin(rawBin: unknown): NapasBank {
  const bin = typeof rawBin === "string" ? rawBin.replace(/\s+/g, "") : "";
  if (!/^\d{6}$/.test(bin)) {
    throw invalidRequest("bankBin is invalid.", {
      bankBin: "bankBin must be a 6-digit NAPAS BIN.",
    });
  }
  const bank = BANK_BY_BIN.get(bin);
  if (!bank) {
    throw notFound("Unsupported NAPAS destination bank BIN.");
  }
  return bank;
}

function normalizeAccountNumber(rawAccountNumber: unknown): string {
  const normalized = typeof rawAccountNumber === "string" ? rawAccountNumber.replace(/\s+/g, "") : "";
  if (!/^\d{6,34}$/.test(normalized)) {
    throw invalidRequest("accountNumber is invalid.", {
      accountNumber: "accountNumber must contain 6 to 34 digits.",
    });
  }
  return normalized;
}

function maskAccountNumber(accountNumber: string): string {
  return `•••• ${accountNumber.slice(-4)}`;
}

function buildTraceId(reference: string, phase: "REQ" | "RCL"): string {
  const digest = createHash("sha256").update(`${phase}:${reference}`).digest("hex").slice(0, 12).toUpperCase();
  return `NAPAS-${digest}`;
}

export class MockNapasGateway {
  listBanks(): readonly NapasBank[] {
    return NAPAS_BANKS;
  }

  inquireAccount(rawBankBin: unknown, rawAccountNumber: unknown): NapasInquiryResult {
    const bank = normalizeBankBin(rawBankBin);
    const accountNumber = normalizeAccountNumber(rawAccountNumber);
    if (/^0+$/.test(accountNumber)) {
      throw notFound("External recipient account not found on NAPAS.");
    }

    let baseName: string;
    if (accountNumber === "99990001") {
      baseName = "NGUYEN VAN MINH";
    } else if (accountNumber.endsWith("9999")) {
      baseName = "PHAM VAN LOI NAPAS";
    } else if (accountNumber.endsWith("8888")) {
      baseName = "TRAN VAN CHO DOI SOAT";
    } else if (accountNumber.endsWith("8899")) {
      baseName = "LE THI HOAN TIEN DOI SOAT";
    } else {
      const digest = createHash("sha256").update(`${bank.bin}:${accountNumber}`).digest();
      const index = digest.readUInt32BE(0) % DETERMINISTIC_HOLDER_NAMES.length;
      baseName = DETERMINISTIC_HOLDER_NAMES[index]!;
    }

    return {
      bank,
      accountNumber,
      maskedAccountNumber: maskAccountNumber(accountNumber),
      accountHolderName: `${baseName} (${bank.shortName})`,
    };
  }

  settleTransfer(request: NapasSettlementRequest): NapasSettlementResult {
    normalizeBankBin(request.bankBin);
    const accountNumber = normalizeAccountNumber(request.accountNumber);
    const napasTraceId = buildTraceId(request.reference, "REQ");

    if (accountNumber.endsWith("9999")) {
      return {
        status: "FAILED",
        napasTraceId,
        responseCode: "68",
        failureReason: "NAPAS_PARTNER_TIMEOUT",
      };
    }

    if (accountNumber.endsWith("8888") || accountNumber.endsWith("8899")) {
      return {
        status: "PENDING",
        napasTraceId,
        responseCode: "09",
        failureReason: null,
      };
    }

    return {
      status: "SUCCEEDED",
      napasTraceId,
      responseCode: "00",
      failureReason: null,
    };
  }

  inquirePendingSettlement(request: {
    reference: string;
    accountNumber: string;
    napasTraceId?: string | null;
  }): NapasSettlementResult {
    const accountNumber = normalizeAccountNumber(request.accountNumber);
    const napasTraceId = request.napasTraceId || buildTraceId(request.reference, "RCL");

    if (accountNumber.endsWith("8899") || accountNumber.endsWith("9999")) {
      return {
        status: "FAILED",
        napasTraceId,
        responseCode: "68",
        failureReason: "NAPAS_SETTLEMENT_REJECTED",
      };
    }

    return {
      status: "SUCCEEDED",
      napasTraceId,
      responseCode: "00",
      failureReason: null,
    };
  }
}

export const defaultNapasGateway = new MockNapasGateway();
