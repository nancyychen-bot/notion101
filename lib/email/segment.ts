interface QMapEntry { prop: string; kind: string }
type QMap = Record<string, QMapEntry>;

const PAID = new Set(["Plus", "Business", "Enterprise"]);

/**
 * Segment a guest by their Notion-plan registration answer.
 * Paid = Plus/Business/Enterprise; everything else (Free, No Account,
 * blank, unknown, missing) = free, so they still get the upgrade nudge.
 * The plan question is found via QUESTION_MAP (prop === "Notion Plan"),
 * so it survives cloned events with different question ids.
 */
export function planSegment(
  answers: Record<string, unknown> | null | undefined,
  questionMap: QMap,
): "free" | "paid" {
  const qid = Object.keys(questionMap).find((k) => questionMap[k].prop === "Notion Plan");
  const value = qid && answers ? String(answers[qid] ?? "").trim() : "";
  return PAID.has(value) ? "paid" : "free";
}
