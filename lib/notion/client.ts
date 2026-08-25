import { Client } from "@notionhq/client";
import { env } from "../env";

let client: Client | null = null;
export function getNotionClient(): Client {
  if (!client) client = new Client({ auth: env.notion.token() });
  return client;
}
