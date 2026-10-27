import type { FirebaseApp } from 'firebase/app';
import { firebaseConfig, firebaseConfigured, recaptchaSiteKey } from './config';

// Lazily boot Firebase so local-only users never download it.

let appPromise: Promise<FirebaseApp | null> | null = null;

export function getFirebaseApp(): Promise<FirebaseApp | null> {
  if (!firebaseConfigured) return Promise.resolve(null);
  appPromise ??= (async () => {
    const { initializeApp } = await import('firebase/app');
    const app = initializeApp(firebaseConfig);
    if (recaptchaSiteKey) {
      try {
        const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import('firebase/app-check');
        initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey), isTokenAutoRefreshEnabled: true });
      } catch (e) {
        console.warn('App Check init failed', e);
      }
    }
    return app;
  })();
  return appPromise;
}
