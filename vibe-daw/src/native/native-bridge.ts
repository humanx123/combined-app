import {nativeThemeColor} from './native-theme';
import {startNativeHaptics} from './native-haptics';
/** ChatRPE's native bridge contract, adapted for this app. Native build changes
 * ship through the App Store; the web must gate optional features by capability.
 * Auth replies require both the sending origin and an unpredictable request ID.
 */
export type NativeCapabilities = {
  version: number; appleAuth: boolean; googleAuth: boolean; haptics: boolean;
  notifications: boolean; fileSharing: boolean; storeReview: boolean;
  shortcuts: boolean; liveActivities: boolean; widgets: boolean;
};
export const WebToNative = {
  APPLE_SIGN_IN:'appleSignIn', GOOGLE_SIGN_IN:'googleSignIn',
  AUTH_TOKEN_UPDATE:'AUTH_TOKEN_UPDATE', AUTH_TOKEN_CLEAR:'AUTH_TOKEN_CLEAR',
  THEME_UPDATE:'THEME_UPDATE', OPEN_URL:'OPEN_URL', HAPTIC:'HAPTIC',
  HAPTIC_SETTINGS:'HAPTIC_SETTINGS', RATING_MOMENT:'RATING_MOMENT',
  START_LIVE_ACTIVITY:'START_LIVE_ACTIVITY', UPDATE_LIVE_ACTIVITY:'UPDATE_LIVE_ACTIVITY', END_LIVE_ACTIVITY:'END_LIVE_ACTIVITY',
  SET_DASHBOARD_WIDGET:'SET_DASHBOARD_WIDGET', SET_DASHBOARD_WIDGETS:'SET_DASHBOARD_WIDGETS', REMOVE_DASHBOARD_WIDGETS:'REMOVE_DASHBOARD_WIDGETS',
  REQUEST_PUSH_PERMISSION:'REQUEST_PUSH_PERMISSION', SHARE_FILE:'SHARE_FILE', GET_CAPABILITIES:'GET_CAPABILITIES',
} as const;
export type NativeMessage = {type:string;requestId?:string;error?:string;idToken?:string;identityToken?:string;rawNonce?:string;authorizationCode?:string;fullName?:{givenName?:string;familyName?:string};token?:string;capabilities?:NativeCapabilities};
declare global {
  interface Window {
    __NATIVE_APP__?:boolean;
    __NATIVE_CAPABILITIES__?:NativeCapabilities;
    ReactNativeWebView?:{postMessage:(message:string)=>void};
  }
}
export function isNativeApp() {return typeof window !== 'undefined' && window.__NATIVE_APP__ === true && Boolean(window.ReactNativeWebView);}
export function hasNativeCapability(capability:keyof NativeCapabilities) {return isNativeApp() && Boolean(window.__NATIVE_CAPABILITIES__?.[capability]);}
export function postToNative(message:{type:typeof WebToNative[keyof typeof WebToNative];[key:string]:unknown}) {
  if(!isNativeApp()) return false;
  window.ReactNativeWebView!.postMessage(JSON.stringify(message)); return true;
}
export function isTrustedNativeMessage(event:MessageEvent) {return event.origin === window.location.origin;}
export function requestNative(type:typeof WebToNative[keyof typeof WebToNative],responseType:string,payload:Record<string,unknown>={},timeoutMs=120000):Promise<NativeMessage> {
  if(!isNativeApp()) return Promise.reject(new Error('Native app required.'));
  return new Promise((resolve,reject)=>{
    const requestId=crypto.randomUUID();
    const cleanup=()=>{clearTimeout(timer);window.removeEventListener('message',handler);};
    const handler=(event:MessageEvent)=>{
      if(!isTrustedNativeMessage(event)) return;
      let data:NativeMessage;
      try {data=typeof event.data === 'string' ? JSON.parse(event.data) : event.data;} catch{return;}
      if(!data || data.type!==responseType || data.requestId!==requestId) return;
      cleanup(); if(data.error) reject(new Error(data.error)); else resolve(data);
    };
    const timer=setTimeout(()=>{cleanup();reject(new Error('The native request timed out. Please try again.'));},timeoutMs);
    window.addEventListener('message',handler);
    postToNative({...payload,type,requestId});
  });
}
export async function nativeAuthCredential(provider:'apple'|'google') {
  const {OAuthProvider,GoogleAuthProvider}=await import('firebase/auth');
  const reply=await requestNative(provider==='apple'?'appleSignIn':'googleSignIn',provider==='apple'?'appleSignInResult':'googleSignInResult');
  if(provider==='apple') {
    if(!reply.identityToken || !reply.rawNonce) throw new Error('Apple returned an incomplete credential.');
    return {credential:new OAuthProvider('apple.com').credential({idToken:reply.identityToken,rawNonce:reply.rawNonce}),reply};
  }
  if(!reply.idToken) throw new Error('Google returned an incomplete credential.');
  return {credential:GoogleAuthProvider.credential(reply.idToken),reply};
}
/** Keep the keychain adapter current for future authenticated Siri extensions.
 * Web auth persistence remains Firebase's responsibility; no raw token in a URL.
 */
export async function startNativeSession(auth:import('firebase/auth').Auth):Promise<()=>void> {
  if(!isNativeApp()) return ()=>{};
  const {onIdTokenChanged}=await import('firebase/auth');
  const stopHaptics=startNativeHaptics();
  const stop=onIdTokenChanged(auth,async user=>{
    if(!user) {postToNative({type:'AUTH_TOKEN_CLEAR'});return;}
    try {
      const token=await user.getIdToken();
      if(auth.currentUser?.uid!==user.uid) return;
      postToNative({type:'AUTH_TOKEN_UPDATE',token,refreshToken:user.refreshToken,userId:user.uid});
    } catch { /* Offline auth stays in Firebase's own persistent session. */ }
  });
  const theme=()=>{
    const root=getComputedStyle(document.documentElement);
    const color=[getComputedStyle(document.body).backgroundColor,root.getPropertyValue('--bg'),root.getPropertyValue('--paper'),root.getPropertyValue('--background')].map(nativeThemeColor).find(Boolean);
    if(color)postToNative({type:'THEME_UPDATE',colors:{background:color}});
  };
  const observer=new MutationObserver(theme);observer.observe(document.documentElement,{attributes:true,attributeFilter:['class','style','data-theme']});theme();
  return ()=>{stop();stopHaptics();observer.disconnect();};
}
/** Native export uses iOS's share sheet (Files, AirDrop, other apps). */
export async function shareNativeFile(blob:Blob,filename:string) {
  if(blob.size>50_000_000) throw new Error('iOS sharing supports exports up to 50 MB. Export a shorter section.');
  const base64=await new Promise<string>((resolve,reject)=>{
    const reader=new FileReader(); reader.onerror=()=>reject(new Error('Could not read the export.'));
    reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(blob);
  });
  await requestNative('SHARE_FILE','SHARE_FILE_RESULT',{base64,filename,mime:blob.type},600000);
}
