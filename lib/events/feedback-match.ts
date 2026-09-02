export interface EventCandidate {
  eventId: string;
  guestId: string;
  eventDate: string; // ISO "YYYY-MM-DD"
}

/**
 * Choose which event a feedback response belongs to. The candidates are the
 * events the matched respondent (by email or name) attended — already
 * authoritative, so there is NO time window: a response that arrives weeks after
 * the event still attributes correctly.
 *
 * - 0 candidates            → null
 * - 1 candidate             → that event (any lateness)
 * - repeat attendee (>1)    → most recent event dated on/before submission
 * - (defensive) all after   → earliest, so a real match is never dropped
 */
export function selectEventForFeedback(
  candidates: EventCandidate[],
  submittedAtISO: string,
): EventCandidate | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const sub = submittedAtISO.slice(0, 10);
  const onOrBefore = candidates.filter((c) => c.eventDate <= sub);
  if (onOrBefore.length > 0) {
    return onOrBefore.reduce((a, b) => (b.eventDate > a.eventDate ? b : a));
  }
  return candidates.reduce((a, b) => (b.eventDate < a.eventDate ? b : a));
}
