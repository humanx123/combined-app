// Adapted from cristonj/ChatRPE mobile/webview-message-routing.ts. See mobile/README.md.
/**
 * The native bridge's inbound half: which documents may drive it
 * (`parseTrustedWebMessage`), and what each message means
 * (`routeWebViewMessage`).
 *
 * The routing table used to live inline in `App.tsx`, where it was the largest
 * remaining block of the component and the only one still growing (#692). It is
 * here instead of there because deciding *what* a message does is separable
 * from *how* the effect is performed: the decisions — which branch a payload
 * satisfies, whether an `OPEN_URL` may reach the OS, when a Live Activity
 * update is worth a haptic — are the part a bug hides in, and this module has
 * no React Native imports, so the root Jest suite can exercise them directly.
 * The effects themselves stay in `use-webview-message-router.ts`, which owns
 * the native modules and the React state.
 */
import { isAppOriginUrl, isOpenableUrl } from "./bridge-urls";
// Straight from the type's own module, not the `native-haptics` re-export: the
// root `tsc --noEmit` reaches this file through `__tests__/mobile/**`, and
// `native-haptics` imports expo-haptics and async-storage, which the web CI job
// does not install. `exclude: ["mobile"]` does not help — it stops globbing,
// not resolution through an included file.
import type { NativeHapticPattern } from "./haptic-feedback";

export type WebMessage = {
  type?: string;
  action?: string;
  token?: string;
  refreshToken?: string;
  firebaseApiKey?: string;
  firebaseStorageBucket?: string;
  userId?: string;
  url?: string;
  requestId?: string;
  theme?: unknown;
  colors?: unknown;
  isDark?: unknown;
  pattern?: NativeHapticPattern;
  sensitivity?: number;
  snapshot?: unknown;
  snapshots?: unknown[];
  dashboardId?: string;
  currentIndex?: number;
};

export type WebMessageParseResult =
  | { accepted: true; message: WebMessage }
  | { accepted: false; reason: "foreign_origin" | "invalid_json" };

/** Parse bridge input only after authenticating the sending document's origin. */
export function parseTrustedWebMessage(
  sourceUrl: unknown,
  raw: string,
  appOrigins: readonly string[]
): WebMessageParseResult {
  if (!isAppOriginUrl(sourceUrl, appOrigins)) {
    return { accepted: false, reason: "foreign_origin" };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { accepted: false, reason: "invalid_json" };
    }
    return { accepted: true, message: parsed as WebMessage };
  } catch {
    return { accepted: false, reason: "invalid_json" };
  }
}

/**
 * The side effects a bridge message can ask for, one per routed action.
 *
 * The three Live Activity entries answer whether the activity actually
 * started, updated, or ended: the native module is iOS-only and its methods
 * are optional (`mobile/ios-templates/AppIntents/*.m` — an unexported method is
 * simply absent in JS, #832), so a `false` means nothing happened and the
 * haptic that accompanies the change must not fire either.
 */
export type WebMessageEffects = {
  storeAuthTokens: (message: WebMessage) => void;
  clearAuthTokens: () => void;
  applyTheme: (message: WebMessage) => void;
  startLiveActivity: (message: WebMessage) => boolean;
  updateLiveActivity: (message: WebMessage) => boolean;
  endLiveActivity: () => boolean;
  haptic: (pattern: NativeHapticPattern) => void;
  /** Persists and applies an already-clamped 0–100 sensitivity. */
  applyHapticSensitivity: (sensitivity: number) => void;
  setDashboardWidget: (snapshot: unknown) => void;
  setDashboardWidgets: (snapshots: unknown[]) => void;
  removeDashboardWidgets: (dashboardId: string) => void;
  recordRatingMoment: () => void;
  openUrl: (url: string) => void;
  requestGoogleSignIn: () => void;
  requestAppleSignIn: () => void;
};

/**
 * The index the running Live Activity was last told about, carried across
 * messages so a repeated `UPDATE_LIVE_ACTIVITY` for the same step does not
 * buzz the device again. A plain box rather than a React ref so this module
 * stays free of React imports.
 */
export type LiveActivityIndexBox = { current: number | null };

function clampSensitivity(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function numericIndex(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/**
 * Performs the effect a trusted bridge message asks for.
 *
 * A message that names no action or fails its own payload check — an unknown
 * `type`, an `AUTH_TOKEN_UPDATE` with no token, an `OPEN_URL` the scheme guard
 * rejected — does nothing.
 *
 * Origin trust is `parseTrustedWebMessage`'s job and has already happened by
 * the time a message reaches here.
 */
export function routeWebViewMessage(
  message: WebMessage,
  effects: WebMessageEffects,
  liveActivityIndex: LiveActivityIndexBox
): void {
  switch (message.type) {
    case "AUTH_TOKEN_UPDATE":
      if (!message.token) return;
      effects.storeAuthTokens(message);
      break;

    case "AUTH_TOKEN_CLEAR":
      effects.clearAuthTokens();
      break;

    case "THEME_UPDATE":
      effects.applyTheme(message);
      break;

    case "START_LIVE_ACTIVITY":
      if (!effects.startLiveActivity(message)) return;
      liveActivityIndex.current = numericIndex(message.currentIndex);
      effects.haptic("success");
      break;

    case "UPDATE_LIVE_ACTIVITY": {
      if (!effects.updateLiveActivity(message)) return;
      const next = numericIndex(message.currentIndex);
      // Only a move to a different step is worth a haptic; a re-send of the
      // same step is the common case (the web side re-posts on every render).
      if (next !== null && next !== liveActivityIndex.current) {
        liveActivityIndex.current = next;
        effects.haptic("selection");
      }
      break;
    }

    case "END_LIVE_ACTIVITY":
      if (!effects.endLiveActivity()) return;
      liveActivityIndex.current = null;
      effects.haptic("success");
      break;

    case "HAPTIC":
      if (!message.pattern) return;
      effects.haptic(message.pattern);
      break;

    case "HAPTIC_SETTINGS":
      if (typeof message.sensitivity !== "number") return;
      effects.applyHapticSensitivity(clampSensitivity(message.sensitivity));
      break;

    case "SET_DASHBOARD_WIDGET":
      if (!message.snapshot) return;
      effects.setDashboardWidget(message.snapshot);
      break;

    case "SET_DASHBOARD_WIDGETS":
      if (!Array.isArray(message.snapshots)) return;
      effects.setDashboardWidgets(message.snapshots);
      break;

    case "REMOVE_DASHBOARD_WIDGETS":
      if (typeof message.dashboardId !== "string") return;
      effects.removeDashboardWidgets(message.dashboardId);
      break;

    case "RATING_MOMENT":
      effects.recordRatingMoment();
      break;

    case "OPEN_URL":
      if (!message.url) return;
      // The origin check covers a foreign document; this covers an XSS on one
      // of our own pages using OPEN_URL as an arbitrary-scheme launcher. Every
      // caller sends an https: checkout or billing-portal URL.
      if (!isOpenableUrl(message.url)) {
        console.warn("Ignoring OPEN_URL with a non-http(s) scheme");
        return;
      }
      effects.openUrl(message.url);
      break;

    case "googleSignIn":
      effects.requestGoogleSignIn();
      break;

    case "appleSignIn":
      effects.requestAppleSignIn();
      break;

    default:
      // The web client has sent Google sign-in as `{ action: "signIn" }` since
      // before the messages carried a `type`; installed builds still do.
      if (message.action === "signIn") effects.requestGoogleSignIn();
  }
}
