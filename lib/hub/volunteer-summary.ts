export interface VolunteerRow {
  experience_score: number | null;
  preparedness_score: number | null;
  city: string | null;
}
export interface VolunteerSummary {
  responses: number;
  avgExperience: number | null;
  avgPreparedness: number | null;
}
function avg(nums: number[]): number | null {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}
export function volunteerSummary(rows: VolunteerRow[]): VolunteerSummary {
  return {
    responses: rows.length,
    avgExperience: avg(rows.map((r) => r.experience_score).filter((n): n is number => n != null)),
    avgPreparedness: avg(rows.map((r) => r.preparedness_score).filter((n): n is number => n != null)),
  };
}
