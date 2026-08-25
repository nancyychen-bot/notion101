// Stub required env vars so modules that call env.X() at import time don't throw
// during unit tests. These are never used for real network calls in tests.
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost/stub";
process.env.LUMA_API_KEY ??= "stub-luma-key";
process.env.NOTION_TOKEN ??= "stub-notion-token";
process.env.NOTION_GUESTS_DATA_SOURCE_ID ??= "stub-ds-id";
process.env.RESEND_API_KEY ??= "stub-resend-key";
process.env.COMMS_FROM ??= "test@example.com";
process.env.DASHBOARD_PASSWORD ??= "stub-password";
process.env.SESSION_SECRET ??= "stub-session-secret";
