import type { IncomingMessage, ServerResponse } from "node:http";
import type { BankingSystem } from "../bankingSystem.js";
import type { HttpOptions } from "../http.js";
import {
  listNotificationsController,
  markNotificationReadController,
} from "../controllers/notificationController.js";

/**
 * Handles user notification routes (Router / URL Dispatcher):
 * - GET /api/v1/notifications: List notifications for user
 * - POST /api/v1/notifications/:id/read: Mark a notification as read
 */
export async function handleNotificationRoute(
  request: IncomingMessage,
  response: ServerResponse,
  segments: readonly string[],
  userId: string,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<boolean> {
  if (segments[0] !== "notifications") {
    return false;
  }

  // GET /notifications
  if (
    request.method === "GET" &&
    segments.length === 1 &&
    segments[0] === "notifications"
  ) {
    await listNotificationsController(response, userId, relationalRoute, options, system, traceId);
    return true;
  }

  // POST /notifications/:id/read
  if (
    request.method === "POST" &&
    segments.length === 3 &&
    segments[0] === "notifications" &&
    segments[2] === "read"
  ) {
    await markNotificationReadController(response, userId, segments[1], relationalRoute, options, system, traceId);
    return true;
  }

  return false;
}
