import { Client } from "@notionhq/client";
import { env } from "../env";

let client: Client | null = null;
export function getNotionClient(): Client {
  if (!client) client = new Client({ auth: env.notion.token() });
  return client;
}

let ambassadorClient: Client | null = null;
/** Notion client for the Ambassador prod workspace (separate token). */
export function getAmbassadorNotionClient(): Client {
  if (!ambassadorClient) ambassadorClient = new Client({ auth: env.notion.ambassadorToken() });
  return ambassadorClient;
}
