import * as Crypto from "expo-crypto";

/**
 * Robust UUIDv4 generator safe for all environments including insecure web contexts (HTTP over LAN IP)
 * where window.crypto.randomUUID is not available in Safari / WebKit.
 */
export function safeRandomUUID(): string {
  try {
    if (typeof Crypto.randomUUID === "function") {
      const id = Crypto.randomUUID();
      if (typeof id === "string" && id.length > 0) {
        return id;
      }
    }
  } catch {
    // Insecure web context where crypto.randomUUID throws or is unavailable
  }

  // Fallback 1: WebCrypto getRandomValues (RFC 4122 v4)
  try {
    if (typeof globalThis.crypto?.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
      bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  } catch {
    // ignore
  }

  // Fallback 2: Pseudo-random Math.random (RFC 4122 v4 format)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
