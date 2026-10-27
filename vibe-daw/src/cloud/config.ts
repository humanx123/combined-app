// Firebase web config comes from VITE_FIREBASE_* env vars at build time.
// These values are public identifiers, not secrets - security comes from
// Firestore/Storage rules and App Check.

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined;

/**
 * Hosted AI (Gemini via Firebase AI Logic, billed to the project owner) is opt-in.
 * Public builds leave it off so every user brings their own Gemini key.
 */


export const firebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

export const hostedAiEnabled = firebaseConfigured && import.meta.env.VITE_HOSTED_AI === 'true';
