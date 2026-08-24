/** Notion guest DB property names (must match the DB the setup script creates). */
export const PROP = {
  name: "Name",
  email: "Email",
  status: "Status",
  checkedIn: "Checked In",
  event: "Event",
  registeredAt: "Registered At",
  company: "Company",
  jobTitle: "Job Title",
  companySize: "Company Size",
  businessTrack: "Business Track",
  notionAccountEmail: "Notion Account Email",
  notionPlan: "Notion Plan",
  notionExperience: "Notion Experience",
  whyAttending: "Why Attending",
  notes: "Notes",
  lumaGuestId: "Luma Guest ID",
  lumaEventId: "Luma Event ID",
} as const;

/** Status select ↔ hub status. Notion is Title Case; the hub is lower-case. */
export const STATUS_TO_NOTION: Record<string, string> = {
  pending: "Pending", approved: "Approved", declined: "Declined", waitlist: "Waitlist",
};
export const NOTION_TO_STATUS: Record<string, "pending" | "approved" | "declined" | "waitlist"> = {
  Pending: "pending", Approved: "approved", Declined: "declined", Waitlist: "waitlist",
};

/**
 * Maps a Luma registration `question_id` → Notion property + how to render it.
 * Populated at setup time by scripts/create-notion-database.ts (written to
 * QUESTION_MAP.json). Loaded here so mappers/push stay pure. `kind` drives the
 * Notion property type used when writing the answer.
 */
export interface QuestionMapEntry {
  prop: string;
  kind: "rich_text" | "select" | "multi_select" | "email";
}
export type QuestionMap = Record<string, QuestionMapEntry>;

// eslint-disable-next-line @typescript-eslint/no-var-requires
import questionMapJson from "./QUESTION_MAP.json";
export const QUESTION_MAP = questionMapJson as QuestionMap;
