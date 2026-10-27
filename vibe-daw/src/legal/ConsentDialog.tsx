import { useEffect, useRef } from 'react';
import { finishLegalAcceptance, useLegalConsent } from './acceptance';
import './legal.css';
import {isNativeApp,hasNativeCapability} from '../native/native-bridge';

function ConsentForm() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="legal-consent" aria-labelledby="legal-consent-title" onCancel={() => finishLegalAcceptance(false)}>
    <h2 id="legal-consent-title">Before you sign in</h2>
    <p>Your sign-in provider shares your profile and email. Your projects, audio library, settings, and Gemini key sync to your private account.</p>
    <p className="legal-consent-agree">By continuing, you confirm you are 18 or older and agree to the <a href="/terms/" target="_blank" rel="noopener noreferrer">Terms of Service</a> and acknowledge the <a href="/privacy/" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</p>
    <div><button className="btn cancel" onClick={() => finishLegalAcceptance(false)}>Cancel</button>
      <button className="btn primary" onClick={() => {useLegalConsent.setState({provider:'apple'});finishLegalAcceptance(true);}}><svg aria-hidden="true" width="1.1em" height="1.1em" viewBox="3 2.5 18 19.5" fill="currentColor" style={{marginRight:6,verticalAlign:"-0.2em"}}><path d="M16.37 12.6c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.87-.76-1.47.02-2.83.86-3.59 2.18-1.53 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.24 2.73 2.2 1.1-.04 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.41 1.2-2.47-.03-.01-2.3-.88-2.33-3.5zM14.2 6.13c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.64-1.05 1.67-.92 2.66.97.08 1.96-.49 2.56-1.21z"/></svg>Continue with Apple</button>
      {(!isNativeApp() || hasNativeCapability('googleAuth')) && <button className="btn primary" onClick={() => {useLegalConsent.setState({provider:'google'});finishLegalAcceptance(true);}}><svg aria-hidden="true" width="1.1em" height="1.1em" viewBox="4 4 40 40" style={{marginRight:6,verticalAlign:"-0.2em"}}><path fill="currentColor" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="currentColor" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="currentColor" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="currentColor" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Continue with Google</button>}
    </div>
  </dialog>;
}
export function ConsentDialog() {
  const open = useLegalConsent(state => state.open);
  return open ? <ConsentForm /> : null;
}
