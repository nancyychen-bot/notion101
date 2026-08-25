/**
 * Normalize Luma registration answers into a flat `question_id -> string` map,
 * shared by the guest-list backfill (register.ts) and the webhook (parse.ts) so
 * both feed QUESTION_MAP identically.
 *
 * Luma `value` is heterogeneous: string, string[] (multi-select), or an object
 * like { company, job_title } for the "company" question type. Naively calling
 * String() on the object produced "[object Object]"; here we:
 *   - company object  -> qid = company, `${qid}::job_title` = job_title
 *   - array           -> comma-joined (the multi_select mapper splits on comma)
 *   - scalar          -> String(value)
 */
export interface RawLumaAnswer {
  question_id?: string | null;
  question_type?: string | null;
  value?: unknown;
  answer?: unknown;
}

export function normalizeAnswers(
  raw: readonly RawLumaAnswer[] | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of raw ?? []) {
    const qid = a?.question_id;
    if (!qid) continue;
    const v = a.value ?? a.answer;

    if (v && typeof v === "object" && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      if ("company" in obj || "job_title" in obj) {
        if (obj.company != null) out[qid] = String(obj.company);
        if (obj.job_title != null) out[`${qid}::job_title`] = String(obj.job_title);
        continue;
      }
      // Unknown object shape — fall back to the scalar `answer` if present.
      out[qid] = a.answer != null ? String(a.answer) : "";
      continue;
    }

    if (Array.isArray(v)) {
      out[qid] = v.map((x) => String(x)).join(", ");
      continue;
    }

    out[qid] = v == null ? "" : String(v);
  }
  return out;
}
