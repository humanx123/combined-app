// Adapted from cristonj/ChatRPE mobile/bridge-urls.ts. See mobile/README.md.
/**
 * URL policy for the native bridge: which documents may *drive* it, and which
 * URLs it may hand to the OS.
 *
 * `window.ReactNativeWebView.postMessage` is injected by react-native-webview
 * into the WebView's main frame whatever document is loaded there — not only
 * ours. `handleWebViewMessage` dispatches on `data.type` alone, so without an
 * origin check any document that becomes the main frame can drive every
 * handler, including `AUTH_TOKEN_UPDATE` (which writes the token Siri App
 * Intents authenticate with, and the one the web client exchanges at
 * `/api/auth/session-token`) and `OPEN_URL` (which reaches `Linking.openURL`).
 * That is a session-fixation primitive, so the bridge checks the sender (#758).
 *
 * On iOS the `url` on a message event is the sending *frame's* request URL —
 * `RNCWebViewImpl.m` overwrites `baseEvent`'s main-document `url` with
 * `message.frameInfo.request.URL` in `didReceiveScriptMessage:`. That is a
 * stronger signal than the main document URL, and it is safe to compare
 * against our own origins because the same file injects the `postMessage`
 * shim with `forMainFrameOnly:YES`: the Firebase Auth iframe and the App Check
 * reCAPTCHA frames have no bridge to post through in the first place, so the
 * guard cannot drop legitimate sub-frame traffic.
 *
 * Comparison is on the *origin*, never on a substring or a path: a same-origin
 * SPA route change does not have to keep `frameInfo.request.URL` in step with
 * `location.pathname` for the check to hold, and a look-alike host such as
 * `https://www.chatrpe.com.example.net` never matches.
 *
 * This module stays free of React Native imports so the guards are unit-testable
 * from the root Jest suite.
 *
 * Note for #757: that PR's `native-bootstrap-injection.ts` carries its own
 * copies of `originOfUrl`/`appOriginsFor` for the outbound half of the same
 * question. Whichever lands second should import from here so the two
 * directions keep one definition of "a document of ours".
 */

/** Schemes `OPEN_URL` may hand to the OS. */
const OPENABLE_SCHEMES: readonly string[] = ["http:", "https:"];

/**
 * The origin of `url`, or `null` when it is not a parseable absolute URL.
 * Callers treat `null` as "matches nothing", so an unparseable or relative URL
 * fails closed.
 */
export function originOfUrl(url: unknown): string | null {
  if (typeof url !== "string" || url.length === 0) return null;
  try {
    const origin = new URL(url).origin;
    // `new URL("about:blank").origin` is the string "null", and so is every
    // other opaque origin — matching on it would match all of them at once.
    return origin && origin !== "null" ? origin : null;
  } catch {
    return null;
  }
}

/**
 * The origins that count as "a document of ours": the app URL's own origin,
 * plus its `www.`/apex sibling on the same scheme and port.
 *
 * The sibling is included because the WebView already treats both as ours —
 * `originWhitelist` lists `https://chatrpe.com` and `https://www.chatrpe.com`,
 * and a host-canonicalizing redirect can land the document on whichever one
 * `EXPO_PUBLIC_APP_URL` is not.
 *
 * Only that one sibling is derived — never a wildcard over sub-domains — so
 * `chatrpe.com.example.net` and preview deployments still get nothing. Returns
 * `[]` when `appUrl` is unparseable, which makes every guard below reject.
 */
export function appOriginsFor(appUrl: unknown): string[] {
  const origin = originOfUrl(appUrl);
  if (!origin) return [];

  const parsed = new URL(origin);
  const host = parsed.hostname.toLowerCase();
  // "www.localhost" is not a thing, and a bare-label sibling is meaningless.
  if (!host.includes(".")) return [origin];

  const sibling = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
  // Composed rather than assigned through `siblingUrl.hostname = sibling`:
  // React Native's `URL` exposes no setter for `hostname`, so that assignment
  // is a write to a getter-only accessor and throws `TypeError` in strict mode
  // — taking the bridge's origin check and the bootstrap-token delivery with
  // it. Expo's winter runtime installs a spec-compliant `URL` that makes the
  // setter work, but only after `InitializeCore`, and nothing here can check
  // that it did (#920).
  const siblingOrigin = `${parsed.protocol}//${sibling}${parsed.port ? `:${parsed.port}` : ""}`;
  return Array.from(new Set([origin, siblingOrigin]));
}

/**
 * True when `url` — a `WebViewMessageEvent`'s `nativeEvent.url` — identifies a
 * document we serve ourselves. An empty `appOrigins` (an unparseable
 * `EXPO_PUBLIC_APP_URL`) rejects everything rather than accepting everything.
 */
export function isAppOriginUrl(
  url: unknown,
  appOrigins: readonly string[],
): boolean {
  const origin = originOfUrl(url);
  return origin !== null && appOrigins.includes(origin);
}

/**
 * True when `url` is safe to hand to `Linking.openURL`.
 *
 * The origin check above keeps a *foreign* document from reaching `OPEN_URL`;
 * this keeps an XSS on one of *our* pages from using it as an arbitrary-scheme
 * launcher (`tel:`, `sms:`, `itms-apps:`, any installed app's custom scheme).
 * Every production caller passes an `https:` checkout link or Stripe
 * billing-portal URL, so http(s) is the whole contract.
 */
export function isOpenableUrl(url: unknown): boolean {
  if (typeof url !== "string" || url.length === 0) return false;
  try {
    return OPENABLE_SCHEMES.includes(new URL(url).protocol);
  } catch {
    return false;
  }
}
