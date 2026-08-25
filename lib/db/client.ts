import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { env } from "../env";

type Sql = NeonQueryFunction<false, false>;

let client: Sql | null = null;
function getClient(): Sql {
  if (!client) client = neon(env.db.url());
  return client;
}

/**
 * Tagged-template SQL client (HTTP), reused across all query modules.
 *
 * Lazily constructed via a Proxy: `neon(env.db.url())` runs on first use, not at
 * import. This keeps importing any query module side-effect-free, so `next build`
 * (which imports route modules to read their config) doesn't require DATABASE_URL.
 */
export const sql: Sql = new Proxy(function () {} as unknown as Sql, {
  apply: (_target, _thisArg, args: unknown[]) =>
    (getClient() as unknown as (...a: unknown[]) => unknown)(...args),
  get: (_target, prop) => (getClient() as unknown as Record<PropertyKey, unknown>)[prop],
});
