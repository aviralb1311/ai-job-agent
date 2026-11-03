export const FOLLOW_UP_BUCKETS = ["OVERDUE", "TODAY", "UPCOMING", "ALL"] as const;
export type FollowUpBucket = typeof FOLLOW_UP_BUCKETS[number];

export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function classifyFollowUpDate(value: Date | string, today: string): Exclude<FollowUpBucket, "ALL"> {
  const dateKey = value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
  if (dateKey < today) return "OVERDUE";
  if (dateKey === today) return "TODAY";
  return "UPCOMING";
}

export function matchesFollowUpBucket(
  value: Date | string,
  bucket: FollowUpBucket,
  today: string
): boolean {
  return bucket === "ALL" || classifyFollowUpDate(value, today) === bucket;
}
