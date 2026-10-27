// Adapted from cristonj/ChatRPE mobile/native-review-policy.ts. See mobile/README.md.
export const NATIVE_REVIEW_MIN_COMPLETED_TURNS = 5;
export const NATIVE_REVIEW_MIN_ACTIVE_DAYS = 3;
export const NATIVE_REVIEW_MIN_ENGAGEMENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type NativeReviewPromptState = {
  firstEngagedAt: number;
  completedTurns: number;
  activeDays: string[];
  requestedAt?: number;
  requestedVersion?: string;
};

function dayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function parseNativeReviewPromptState(
  stored: string | null,
): NativeReviewPromptState | null {
  if (!stored) return null;

  try {
    const value = JSON.parse(stored) as Partial<NativeReviewPromptState>;
    if (
      typeof value.firstEngagedAt !== "number" ||
      !Number.isFinite(value.firstEngagedAt) ||
      typeof value.completedTurns !== "number" ||
      !Number.isFinite(value.completedTurns) ||
      !Array.isArray(value.activeDays)
    ) {
      return null;
    }

    return {
      firstEngagedAt: value.firstEngagedAt,
      completedTurns: Math.max(0, Math.floor(value.completedTurns)),
      activeDays: value.activeDays.filter(
        (day): day is string => typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day),
      ),
      ...(typeof value.requestedAt === "number" && Number.isFinite(value.requestedAt)
        ? { requestedAt: value.requestedAt }
        : {}),
      ...(typeof value.requestedVersion === "string"
        ? { requestedVersion: value.requestedVersion }
        : {}),
    };
  } catch {
    return null;
  }
}

export function recordCompletedTurn(
  state: NativeReviewPromptState | null,
  now: number,
): NativeReviewPromptState {
  const currentDay = dayKey(now);
  const activeDays = state?.activeDays.includes(currentDay)
    ? state.activeDays
    : [...(state?.activeDays ?? []), currentDay];

  return {
    firstEngagedAt: state?.firstEngagedAt ?? now,
    completedTurns: (state?.completedTurns ?? 0) + 1,
    activeDays,
    ...(state?.requestedAt != null ? { requestedAt: state.requestedAt } : {}),
    ...(state?.requestedVersion ? { requestedVersion: state.requestedVersion } : {}),
  };
}

/**
 * Ask only after repeated, multi-day success and only once for the lifetime of
 * this installation. StoreKit does not reveal whether the user rated or
 * dismissed, so a one-shot policy is the only reliable way not to nag either
 * path.
 */
export function isEligibleForNativeReview(
  state: NativeReviewPromptState,
  now: number,
): boolean {
  return (
    state.requestedAt == null &&
    state.completedTurns >= NATIVE_REVIEW_MIN_COMPLETED_TURNS &&
    new Set(state.activeDays).size >= NATIVE_REVIEW_MIN_ACTIVE_DAYS &&
    now - state.firstEngagedAt >= NATIVE_REVIEW_MIN_ENGAGEMENT_AGE_MS
  );
}
