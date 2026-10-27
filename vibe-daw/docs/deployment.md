# Deploying Vibe

The public site is https://vibedaw.org. `/` is the landing page and `/studio` is the workstation. Netlify's existing SPA rewrite supports both. Link directly to `/studio` to reopen the last locally saved project.

## Optional donations

The landing page shows the project's Bitcoin and Monero addresses by default. To use your own, or to add more, set any of these **public receiving addresses** in Netlify's build environment, then rebuild:

| Variable | Network shown on the page |
| --- | --- |
| `VITE_DONATION_BTC_ADDRESS` | Bitcoin (defaults to the project's address) |
| `VITE_DONATION_XMR_ADDRESS` | Monero (defaults to the project's address) |
| `VITE_DONATION_ETH_ADDRESS` | Ethereum mainnet |
| `VITE_DONATION_SOL_ADDRESS` | Solana |

Only configured addresses appear. Each has a copy button and a QR code of its payment link (such as `bitcoin:<address>`) for scanning with a phone wallet. Never put private keys, recovery phrases, or credentials in `VITE_*` variables: they are public build inputs.

## Automatic Firebase rules deployments

`.github/workflows/firebase-rules.yml` deploys Firestore rules, indexes, and Storage rules when their source/config changes on `main`. It also supports a manual run from `main`. It does not deploy from pull requests or feature branches.

Authentication uses GitHub OIDC and Google Workload Identity Federation with short-lived credentials. No service-account JSON key is needed.

1. Create a GitHub environment named `production` and set these environment variables:

   | Variable | Value |
   | --- | --- |
   | `FIREBASE_PROJECT_ID` | Actual Firebase project ID |
   | `FIREBASE_WORKLOAD_IDENTITY_PROVIDER` | Full `projects/…/locations/global/workloadIdentityPools/…/providers/…` resource name |
   | `FIREBASE_SERVICE_ACCOUNT` | Deployment service account email |

2. Configure the Google provider to trust this repository's GitHub OIDC identity. Restrict its attribute condition to your repository ID and `refs/heads/main`. When using the default `sub` mapping, the environment subject is `repo:cristonj/Vibe-DAW:environment:production`.
3. Grant that identity `roles/iam.workloadIdentityUser` on the deployment service account. Give the service account Firebase Rules Admin and Cloud Datastore Index Admin on the target project, plus the read/service-usage permissions required for Firebase CLI project and bucket discovery (Firebase Viewer, Storage Viewer, Service Usage Consumer).
4. Enable the Firebase Rules, Firestore, Storage, and required Google APIs in the target Firebase project. Test with **Run workflow** on `main`, then inspect the rules in Firebase Console.

The workflow validates that the three variables exist before authenticating. Its actions are pinned to commit SHAs and Firebase CLI is pinned to `15.34.0`. Deployment runs are serialized without canceling an in-progress rules update. Keep environment approval settings consistent with your desired automatic deployment policy.

No live Firebase deployment is performed when developing or testing this PR. The actual project/provider/account must be configured by an administrator before the workflow can deploy.

## Library rules and local verification

Account library records live under `users/{uid}/library/{itemId}` and use the existing owner-only sample metadata and Storage paths. Deploy the rules before testing account library sync on a hosted build; otherwise the UI retains local saves and reports the permission error. Custom instructions use the existing owner-only `prefs/main` AI section. No additional index is needed for the library listener.

`npm run test:rules` runs owner/isolation/payload/tombstone/preferences checks against the local Firestore emulator using the pinned Firebase CLI. Install Java 21 first. The CI rules job installs Java and runs these tests independently of browser checks. The `demo-vibe-tests` emulator project never accesses a live Firebase project.
