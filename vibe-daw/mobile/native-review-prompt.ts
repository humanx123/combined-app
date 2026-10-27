// Adapted from cristonj/ChatRPE mobile/native-review-prompt.ts. See mobile/README.md.
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as StoreReview from "expo-store-review";
import { AppState, Platform } from "react-native";
import {
  isEligibleForNativeReview,
  parseNativeReviewPromptState,
  recordCompletedTurn,
} from "./native-review-policy";

const REVIEW_PROMPT_STORAGE_KEY = "@vibedaw_native_review_prompt_v1";
const REVIEW_PROMPT_SETTLE_DELAY_MS = 1200;

let reviewMomentInFlight: Promise<void> | null = null;

function waitForSettledInterface(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, REVIEW_PROMPT_SETTLE_DELAY_MS));
}

async function processNativeReviewMoment(): Promise<void> {
  if (Platform.OS !== "ios") return;

  const now = Date.now();
  const stored = await AsyncStorage.getItem(REVIEW_PROMPT_STORAGE_KEY);
  const nextState = recordCompletedTurn(parseNativeReviewPromptState(stored), now);
  await AsyncStorage.setItem(REVIEW_PROMPT_STORAGE_KEY, JSON.stringify(nextState));

  if (!isEligibleForNativeReview(nextState, now)) return;

  // Let the completed coach response and its haptic settle. The review sheet
  // then appears at a natural pause rather than interrupting the task itself.
  await waitForSettledInterface();
  if (AppState.currentState !== "active" || !(await StoreReview.isAvailableAsync())) return;

  await AsyncStorage.setItem(REVIEW_PROMPT_STORAGE_KEY, JSON.stringify({
    ...nextState,
    requestedAt: Date.now(),
    requestedVersion: Constants.expoConfig?.version ?? "unknown",
  }));
  await StoreReview.requestReview();
}

/** Record one successfully completed native chat turn and request Apple's
 * system rating sheet if the device-local engagement policy is now satisfied. */
export function recordNativeReviewMoment(): Promise<void> {
  if (reviewMomentInFlight) return reviewMomentInFlight;

  reviewMomentInFlight = processNativeReviewMoment()
    .catch(() => {
      // Ratings are enhancement-only; storage or StoreKit failures must never
      // interfere with chat completion.
    })
    .finally(() => {
      reviewMomentInFlight = null;
    });
  return reviewMomentInFlight;
}
