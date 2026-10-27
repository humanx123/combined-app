// Adapted from cristonj/ChatRPE mobile/haptic-feedback.ts. See mobile/README.md.
export type NativeHapticPattern =
  | "press"
  | "send"
  | "message-complete"
  | "selection"
  | "drag-start"
  | "drag-tick"
  | "drop"
  | "success"
  | "warning"
  | "error";

export const DEFAULT_HAPTIC_SENSITIVITY = 70;

export type HapticImpactStyle = "light" | "medium" | "heavy" | "soft" | "rigid";
export type HapticNotificationType = "success" | "warning" | "error";
export type ResolvedHapticFeedback =
  | { kind: "none" }
  | { kind: "selection" }
  | { kind: "impact"; style: HapticImpactStyle }
  | { kind: "impact-sequence"; style: HapticImpactStyle; count: number; intervalMs: number }
  | { kind: "notification"; type: HapticNotificationType };

export function normalizeHapticSensitivity(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric)
    ? Math.min(100, Math.max(0, Math.round(numeric)))
    : DEFAULT_HAPTIC_SENSITIVITY;
}

export function resolveHapticFeedback(
  pattern: NativeHapticPattern,
  sensitivity: number,
): ResolvedHapticFeedback {
  const strength = normalizeHapticSensitivity(sensitivity);
  if (strength === 0) return { kind: "none" };

  if (pattern === "send") {
    return { kind: "impact", style: "light" };
  }

  if (pattern === "message-complete") {
    return {
      kind: "impact-sequence",
      style: strength < 80 ? "light" : "rigid",
      count: 2,
      intervalMs: 85,
    };
  }

  if (pattern === "success" || pattern === "warning" || pattern === "error") {
    if (strength < 35) return { kind: "impact", style: "light" };
    return { kind: "notification", type: pattern };
  }

  if (pattern === "selection" || pattern === "drag-tick") {
    return strength < 80
      ? { kind: "selection" }
      : { kind: "impact", style: "rigid" };
  }

  if (pattern === "drag-start") {
    return { kind: "impact", style: strength < 55 ? "soft" : "rigid" };
  }

  const style = strength < 35 ? "light" : strength < 75 ? "medium" : "heavy";
  return { kind: "impact", style };
}
