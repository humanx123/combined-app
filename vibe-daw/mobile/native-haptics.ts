// Adapted from cristonj/ChatRPE mobile/native-haptics.ts. See mobile/README.md.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import {
  DEFAULT_HAPTIC_SENSITIVITY,
  normalizeHapticSensitivity,
  resolveHapticFeedback,
  type HapticImpactStyle,
  type HapticNotificationType,
  type NativeHapticPattern,
} from "./bridge/haptic-feedback";

export { DEFAULT_HAPTIC_SENSITIVITY } from "./bridge/haptic-feedback";
export type { NativeHapticPattern } from "./bridge/haptic-feedback";
const HAPTIC_SENSITIVITY_KEY = "@vibedaw_haptic_sensitivity";

const IMPACT_STYLES: Record<HapticImpactStyle, Haptics.ImpactFeedbackStyle> = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
  soft: Haptics.ImpactFeedbackStyle.Soft,
  rigid: Haptics.ImpactFeedbackStyle.Rigid,
};

const NOTIFICATION_TYPES: Record<HapticNotificationType, Haptics.NotificationFeedbackType> = {
  success: Haptics.NotificationFeedbackType.Success,
  warning: Haptics.NotificationFeedbackType.Warning,
  error: Haptics.NotificationFeedbackType.Error,
};

export async function loadHapticSensitivity(): Promise<number> {
  const stored = await AsyncStorage.getItem(HAPTIC_SENSITIVITY_KEY);
  return stored == null
    ? DEFAULT_HAPTIC_SENSITIVITY
    : normalizeHapticSensitivity(stored);
}

export async function persistHapticSensitivity(value: number): Promise<number> {
  const normalized = normalizeHapticSensitivity(value);
  await AsyncStorage.setItem(HAPTIC_SENSITIVITY_KEY, String(normalized));
  return normalized;
}

export async function performNativeHaptic(
  pattern: NativeHapticPattern,
  sensitivity: number,
): Promise<void> {
  try {
    const feedback = resolveHapticFeedback(pattern, sensitivity);
    if (feedback.kind === "none") return;
    if (feedback.kind === "selection") {
      await Haptics.selectionAsync();
    } else if (feedback.kind === "impact") {
      await Haptics.impactAsync(IMPACT_STYLES[feedback.style]);
    } else if (feedback.kind === "impact-sequence") {
      for (let index = 0; index < feedback.count; index += 1) {
        if (index > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, feedback.intervalMs));
        }
        await Haptics.impactAsync(IMPACT_STYLES[feedback.style]);
      }
    } else {
      await Haptics.notificationAsync(NOTIFICATION_TYPES[feedback.type]);
    }
  } catch {
    // Haptics are enhancement-only and must never interrupt the gesture.
  }
}
