# Vibe iOS

Expo SDK 57 WebView host adapted from the working cristonj/ChatRPE mobile package.
`bridge-urls.ts`, `webview-message-routing.ts`, haptics, and review eligibility are
copied from ChatRPE; app identity and web integrations are specific to this app.

Install with `npm ci`, run `npm run typecheck` and `npx expo install --check`.
The root website and mobile package have independent dependency trees.

## Release

Use GitHub Actions → **iOS Build & Submit** → **Run workflow**. Builds are manual
only. Check **submit** to upload the exact completed archive to App Store Connect;
that does not request App Review or release the app. Submission requires main.
App Store version release is manual. Increment `version` in app.config.js for a
new public release; EAS manages the build number remotely. No OTA updates.

EAS project: 2bed4eb6-60cb-45e2-a29f-466d8f72564f
Bundle ID: org.vibedaw.app
Apple team: FRW37USW79
App Store ID: 6825012825

GitHub Actions uses the EXPO_TOKEN secret already configured for this repository.
EAS Submit uses the hosted App Store Connect API key J3N329BWMJ; no Apple password
is required. The public Google iOS client ID is checked into app-identity.json
and can be overridden with EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID. Distribution signing
credentials are hosted by EAS. Renew the shared certificate before December 29, 2026.

## Bridge

The web contract is src/native/native-bridge.ts.
Native inbound traffic checks the sending frame's exact origin. Outbound secrets
are injected only after checking the document origin at execution time. Auth
responses must match the web request's random requestId and same origin. Foreign
websites open in the system browser; Firebase/reCAPTCHA are allowed only as known
subframes. Tokens stay out of URLs and AsyncStorage; the native cache uses Keychain.

Active capabilities: Apple sign-in with a Firebase nonce, configured Google sign-in,
haptics, iOS share sheet for files, optional Expo push registration, system review
eligibility, custom/universal links, and an App Intent to open the main experience.
Notifications request permission only when REQUEST_PUSH_PERMISSION is sent after
a user action. SET_PUSH_TOKEN delivers the result to the website; a future feature
must persist it to an authenticated backend before sending pushes.

The copied START/UPDATE/END_LIVE_ACTIVITY and dashboard-widget routing hooks call
optional native LiveActivityModule/AppIntentsStorage adapters. Their capabilities
are false until those Swift modules and extension targets are added. Do not expose
feature UI based solely on __NATIVE_APP__: use hasNativeCapability. Siri's Open App Intent is available on iOS 18 and later; authenticated background Siri actions, widgets, and Live
Activities are future additions. They require App Groups/keychain access groups,
extension provisioning, and device validation when implemented.

Native changes require a new binary. Keep the continuously deployed website
compatible with older installed capability versions. Browser offline caching does
not guarantee WKWebView offline launches; native load failures show a retry screen.

## Account deletion

The account control reauthenticates, revokes Apple authorization, writes an
owner-only deletion tombstone, removes the account's data, then deletes Firebase
Auth. The UID/time-only tombstone blocks still-valid tokens on other devices from
recreating deleted data. Failed deletions remain retryable. Apple revocation runs
in netlify/functions/revoke-apple.mjs using server-only APPLE_SIGN_IN_PRIVATE_KEY
and APPLE_SIGN_IN_KEY_ID. Never prefix these secrets with VITE_, NEXT_PUBLIC_, or
EXPO_PUBLIC_. No private keys or signing files belong in Git.

Pure trust-boundary helpers live in bridge/ with an independent TypeScript config,
so website CI tests them without installing Expo.

App Store screenshots are made on your own machine with `npm run appstore-screenshots`
from the repository root; see docs/APP_STORE_SCREENSHOTS.md.

Native feedback: transport play uses a press pulse and agent completion uses a double pulse; other buttons use restrained selection feedback. Settings > Touch feedback disables it on this device. The WebView fills the display while CSS safe-area variables inset controls. Page RGB backgrounds synchronize the shell and status bar. This change preserves the existing audio rendering pipeline and .vibe project format.
