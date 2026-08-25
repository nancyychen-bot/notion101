import { NextResponse, type NextRequest } from "next/server";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";

/**
 * Guard the dashboard (`/`) only. `/add-event` is intentionally NOT session-gated:
 * per design §6.1 it is embedded in a Notion iframe and protected by a short-lived
 * form token instead (a sameSite=lax session cookie wouldn't be sent in the iframe).
 * All API routes, `/login`, and static assets are excluded from the matcher so
 * external callers (Luma, Notion, Vercel Cron) reach webhooks/cron/health without a session.
 */
export async function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";

  // Fail closed: if the signing secret is missing (e.g. not deployed to the
  // Edge runtime), NEVER verify against an empty key — that would let anyone
  // forge a cookie. Treat it as unauthenticated.
  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.redirect(url);

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (await isValidSession(token, secret)) return NextResponse.next();
  return NextResponse.redirect(url);
}

// Guard only the dashboard root. Everything else (login, /add-event, all API
// routes, Next internals, static assets) is excluded from the matcher and remains
// fully public. /add-event is form-token protected (design §6.1); webhook/cron/health
// routes are never matched, so external callers are never challenged for a session.
export const config = {
  matcher: ["/", "/settings/:path*"],
};
