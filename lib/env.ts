function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}. See .env.example.`);
  return value;
}
function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const env = {
  db: { url: () => required("DATABASE_URL") },
  luma: {
    apiKey: () => required("LUMA_API_KEY"),
    webhookSecret: () => optional("LUMA_WEBHOOK_SECRET"),
  },
  notion: {
    token: () => required("NOTION_TOKEN"),
    guestsDataSourceId: () => required("NOTION_GUESTS_DATA_SOURCE_ID"),
    guestsDbId: () => optional("NOTION_GUESTS_DB_ID"),
    webhookSecret: () => optional("NOTION_WEBHOOK_SECRET"),
    feedbackDbId: () => optional("NOTION_FEEDBACK_DB_ID"),
  },
  comms: {
    apiKey: () => required("RESEND_API_KEY"),
    from: () => required("COMMS_FROM"),
    replyTo: () => optional("COMMS_REPLY_TO"),
    enabled: () => optional("COMMS_ENABLED") !== "false",
  },
  app: {
    baseUrl: () => optional("APP_BASE_URL") ?? "http://localhost:3000",
    cronSecret: () => optional("CRON_SECRET"),
    surveyUrl: () => optional("SURVEY_URL"),
    freeTrialUrl: () => optional("FREE_TRIAL_URL") ?? "https://www.notion.so/product",
  },
  dashboard: {
    password: () => required("DASHBOARD_PASSWORD"),
    sessionSecret: () => required("SESSION_SECRET"),
  },
} as const;
