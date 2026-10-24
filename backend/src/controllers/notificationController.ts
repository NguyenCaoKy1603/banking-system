import type { ServerResponse } from "node:http";
import type { BankingSystem } from "../bankingSystem.js";
import type { HttpOptions } from "../http.js";
import { writeResponse } from "../routes/httpUtils.js";

/**
 * Notification Controller (Tầng Controller - Xử lý Request/Response cho Thông báo biến động số dư & sự kiện)
 */

export async function listNotificationsController(
  response: ServerResponse,
  userId: string,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  writeResponse(
    response,
    200,
    traceId,
    relationalRoute && options.relationalHttp
      ? { items: await options.relationalHttp.listNotifications(userId) }
      : { items: system.listNotifications(userId) },
  );
}

export async function markNotificationReadController(
  response: ServerResponse,
  userId: string,
  notificationId: string,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  writeResponse(
    response,
    200,
    traceId,
    relationalRoute && options.relationalHttp
      ? await options.relationalHttp.markNotificationRead(userId, notificationId)
      : system.markNotificationRead(userId, notificationId),
  );
}
