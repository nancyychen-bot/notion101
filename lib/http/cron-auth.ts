import { env } from "../env";

/** True if the request carries the cron secret (header or bearer). */
export function isAuthorizedCron(req: Request): boolean {
  const secret = env.app.cronSecret();
  if (!secret) return false;
  const provided =
    req.headers.get("x-cron-secret") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return provided === secret;
}
