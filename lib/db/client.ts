import { neon } from "@neondatabase/serverless";
import { env } from "../env";

/** Tagged-template SQL client (HTTP). Reused across all query modules. */
export const sql = neon(env.db.url());
