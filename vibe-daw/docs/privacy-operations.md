# Privacy operations

Confirm the operator's legal name, working privacy contact email, and state/country before publishing. Review policies for the actual audience and jurisdictions. Documents, checkboxes, and tests alone do not establish legal compliance.

Monitor the published contact email, record requests and response deadlines, and verify ownership proportionately using the account email. Avoid collecting government ID by default. Support access, export, correction, deletion, restriction, objections, and appeals as applicable.

For an access request, use the verified Firebase Auth UID and export only that user's Firestore projects, sample metadata, library, preferences, and agreement record plus their Storage audio as requested. Preferences contain the Gemini API key: handle exports as credentials and use a secure delivery channel.

For a deletion request, explain permanent loss and allow export first. An authorized operator must stop account access, remove all subcollections under `users/{uid}`, remove that user's Storage objects, and remove the Firebase Authentication account. Deleting a parent document does not delete Firestore subcollections. Verify both database and audio storage without touching another account. Local browser data, exported files, and Google AI provider records require separate handling. Explain any legally necessary retained records and provider backup/log retention. Keep retained records access-limited and no longer than necessary.

Restrict administrator access and use strong Google account protection. Owner-only database rules do not exclude authorized administrators. Assess incidents and any required notifications with qualified advice.

The policy and signup receipt version is `2026-10-20`. Publish future policy changes with matching frontend/rule versions and preserve agreement evidence. Receipts at `users/{uid}/legal/current` contain policy versions, adult confirmation, and a server timestamp. AI acknowledgement is per browser in `vibe:ai-consent`; it is not a record of Google API billing eligibility or permission to use someone else's material.

Optional Gemini use is for adults and professional/business purposes under Google's current terms. Supported-region and paid-tier obligations must be evaluated before making hosted AI available. Do not turn on hosted AI, add tracking, or change processors/data uses without reviewing the policy and required safeguards. The user's own key is synchronized in owner-only preferences when signed in, so revocation in Google Cloud may be necessary after shared-device exposure.
