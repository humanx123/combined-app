import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, NativeModules, Platform, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as Apple from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import identity from './app-identity.json';
import { appOriginsFor, isAppOriginUrl, isOpenableUrl } from './bridge/bridge-urls';
import { parseTrustedWebMessage, routeWebViewMessage } from './bridge/webview-message-routing';
import { loadHapticSensitivity, performNativeHaptic, persistHapticSensitivity } from './native-haptics';
import { recordNativeReviewMoment } from './native-review-prompt';

WebBrowser.maybeCompleteAuthSession();
const APP_URL = `https://${identity.domain}${identity.entry}`;
const ORIGINS = appOriginsFor(APP_URL);
const MODULES = NativeModules;
const googleClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || identity.googleIosClientId;
const SAFE_PAGES = identity.repo === 'Vibe-DAW' ? ['/studio'] : identity.repo === 'MusicTheory' ? ['/path', '/learn', '/practice', '/tools', '/placement'] : ['/game', '/profile', '/leaderboard'];

// Both entry points are external input. Rebuild on our origin and admit pages only.
function deepLinkTarget(raw: string): string | null {
  try {
    const url = raw.startsWith(`${identity.scheme}://`)
      ? new URL('/' + raw.slice(identity.scheme.length + 3).replace(/^\/+/, ''), APP_URL)
      : new URL(raw);
    if (!isAppOriginUrl(url.href, ORIGINS)) return null;
    if (!SAFE_PAGES.some(p => url.pathname === p || url.pathname.startsWith(p + '/'))) return null;
    return new URL(url.pathname + url.search + url.hash, APP_URL).href;
  } catch { return null; }
}

function capabilities() {
  return {
    version: 1, appleAuth: true, googleAuth: Boolean(googleClientId), haptics: true,
    notifications: true, fileSharing: true, storeReview: true, shortcuts: Number.parseInt(String(Platform.Version), 10) >= 18,
    liveActivities: Boolean(MODULES.LiveActivityModule?.startActivity),
    widgets: Boolean(MODULES.AppIntentsStorage?.setDashboardWidgetSnapshot),
  };
}

export default function App(){return <SafeAreaProvider><NativeShell /></SafeAreaProvider>;}

function NativeShell() {
  const safeArea=useSafeAreaInsets();
  const web = useRef<WebView>(null);
  const [source, setSource] = useState(APP_URL);
  const [webKey, setWebKey] = useState(0);
  const [failed, setFailed] = useState(false);
  const systemTheme=useColorScheme();
  const pageThemeReceived=useRef(false);
  const [background, setBackground] = useState(systemTheme === 'dark' ? '#000000' : identity.background);
  useEffect(()=>{if(!pageThemeReceived.current)setBackground(systemTheme === 'dark' ? '#000000' : identity.background);},[systemTheme]);
  const shellDark=[1,3,5].map((at)=>parseInt(background.slice(at,at+2),16)).reduce((sum,n,i)=>sum+n*[0.2126,0.7152,0.0722][i],0)<140;
  const [sensitivity, setSensitivity] = useState(70);
  const liveIndex = useRef<number | null>(null);
  const authBusy = useRef(false);
  const bridgeBootstrap=`(function(){if(!${JSON.stringify(ORIGINS)}.includes(location.origin))return;window.__NATIVE_APP__=true;window.__NATIVE_CAPABILITIES__=${JSON.stringify(capabilities())};var s=${JSON.stringify(safeArea)};window.__NATIVE_SAFE_AREA__=s;function apply(){if(!document.documentElement)return;document.documentElement.dataset.nativeApp='true';for(var side of ['top','right','bottom','left'])document.documentElement.style.setProperty('--native-safe-'+side,s[side]+'px');}apply();document.addEventListener('DOMContentLoaded',apply,{once:true});})();true;`;
  useEffect(()=>{web.current?.injectJavaScript(bridgeBootstrap);},[bridgeBootstrap]);
  const googlePending = useRef<string | null>(null);
  const queuedDeepLink = useRef<string | null>(null);
  const [googleRequest, googleResponse, promptGoogle] = Google.useIdTokenAuthRequest({
    iosClientId: googleClientId || 'unconfigured.apps.googleusercontent.com',
    selectAccount: true,
  });

  // Like ChatRPE's guardToAppOrigins: check at execution time, including after redirects.
  function send(message: Record<string, unknown>) {
    web.current?.injectJavaScript(`(function(){if(!${JSON.stringify(ORIGINS)}.includes(location.origin))return;window.postMessage(${JSON.stringify(message)},location.origin);})();true;`);
  }

  async function signInApple(requestId?: string) {
    if (authBusy.current) { send({type:'appleSignInResult', requestId, error:'Sign-in is already open.'}); return; }
    authBusy.current = true;
    try {
      if (!await Apple.isAvailableAsync()) throw new Error('Apple sign-in is unavailable on this device.');
      const rawNonce = Crypto.randomUUID() + Crypto.randomUUID();
      const nonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
      const credential = await Apple.signInAsync({nonce, requestedScopes:[Apple.AppleAuthenticationScope.FULL_NAME, Apple.AppleAuthenticationScope.EMAIL]});
      if (!credential.identityToken) throw new Error('Apple did not return a sign-in token.');
      send({type:'appleSignInResult', requestId, identityToken:credential.identityToken, rawNonce,
        authorizationCode:credential.authorizationCode, fullName:credential.fullName});
    } catch (error) {
      const code = (error as {code?:string}).code;
      send({type:'appleSignInResult', requestId, error:code === 'ERR_REQUEST_CANCELED' ? 'Sign-in canceled.' : 'Apple sign-in failed. Please try again.'});
    } finally { authBusy.current = false; }
  }

  async function signInGoogle(requestId?: string) {
    if (!requestId) return;
    if (!googleClientId || !googleRequest || authBusy.current) {
      send({type:'googleSignInResult',requestId,error:!googleClientId ? 'Google sign-in is not configured for this build. Use Apple or continue without an account.' : 'Please wait and try again.'});
      return;
    }
    authBusy.current = true; googlePending.current = requestId;
    try { await promptGoogle(); }
    catch { send({type:'googleSignInResult',requestId,error:'Google sign-in could not open.'}); googlePending.current = null; authBusy.current = false; }
  }

  useEffect(() => {
    if (!googleResponse || !googlePending.current) return;
    const requestId = googlePending.current;
    googlePending.current = null; authBusy.current = false;
    const idToken = googleResponse.type === 'success' ? googleResponse.params.id_token : undefined;
    send({type:'googleSignInResult',requestId,...(idToken ? {idToken} : {error:'Google sign-in canceled or failed.'})});
  }, [googleResponse]);

  useEffect(() => {
    void loadHapticSensitivity().then(setSensitivity).catch(() => {});
    const navigate = (raw: string) => {
      const target = deepLinkTarget(raw);
      if (!target) return;
      queuedDeepLink.current = target;
      setSource(target); setWebKey(k => k + 1);
    };
    void Linking.getInitialURL().then(url => {if(url) navigate(url);});
    const linkSub = Linking.addEventListener('url', event => navigate(event.url));
    const notificationSub = Notifications.addNotificationResponseReceivedListener(response => {
      const url = response.notification.request.content.data?.url;
      if (typeof url === 'string') navigate(url);
    });
    return () => {linkSub.remove(); notificationSub.remove();};
  }, []);

  async function shareFile(message: Record<string, unknown>) {
    const requestId = message.requestId;
    let file: string | null = null;
    try {
      if (typeof message.base64 !== 'string' || message.base64.length > 70_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(message.base64)) throw new Error('Invalid file');
      if (!await Sharing.isAvailableAsync()) throw new Error('Sharing unavailable');
      const name = String(message.filename || 'export').replace(/[^\w. -]/g,'_').replace(/^\.+/, '_').slice(0,100);
      const directory = FileSystem.cacheDirectory + Crypto.randomUUID() + '/';
      await FileSystem.makeDirectoryAsync(directory, {intermediates:true});
      file = directory + name;
      await FileSystem.writeAsStringAsync(file, message.base64, {encoding:FileSystem.EncodingType.Base64});
      await Sharing.shareAsync(file, {mimeType:typeof message.mime === 'string' ? message.mime : undefined});
      send({type:'SHARE_FILE_RESULT',requestId,success:true});
    } catch { send({type:'SHARE_FILE_RESULT',requestId,error:'Could not share this file. Try a smaller export.'}); }
    finally {if(file) await FileSystem.deleteAsync(file.slice(0,file.lastIndexOf('/')), {idempotent:true}).catch(() => {});}
  }

  async function requestPush(requestId: unknown) {
    try {
      const permission = await Notifications.requestPermissionsAsync();
      if (!permission.granted) {send({type:'SET_PUSH_TOKEN',requestId,error:'Notification permission was not granted.'}); return;}
      const token = await Notifications.getExpoPushTokenAsync({projectId:Constants.expoConfig?.extra?.eas?.projectId});
      send({type:'SET_PUSH_TOKEN',requestId,token:token.data});
    } catch {send({type:'SET_PUSH_TOKEN',requestId,error:'Push registration failed. Please try again.'});}
  }

  function onMessage(event: WebViewMessageEvent) {
    const parsed = parseTrustedWebMessage(event.nativeEvent.url, event.nativeEvent.data, ORIGINS);
    if (!parsed.accepted) return;
    const message = parsed.message;
    if (message.type === 'GET_CAPABILITIES') {send({type:'NATIVE_CAPABILITIES',requestId:message.requestId,capabilities:capabilities()}); return;}
    if (message.type === 'REQUEST_PUSH_PERMISSION') {void requestPush(message.requestId); return;}
    if (message.type === 'SHARE_FILE') {void shareFile(message as Record<string,unknown>); return;}
    routeWebViewMessage(message, {
      storeAuthTokens: m => {
        // Keychain only. No auth tokens in URLs or AsyncStorage; future Siri modules
        // can replace this adapter with an App Group keychain access group.
        if(typeof m.token === 'string') void SecureStore.setItemAsync('firebase-id-token',m.token).catch(() => {});
        if(typeof m.refreshToken === 'string') void SecureStore.setItemAsync('firebase-refresh-token',m.refreshToken).catch(() => {});
        MODULES.AppIntentsStorage?.setAuthToken?.(m.token);
      },
      clearAuthTokens: () => {
        void Promise.all(['firebase-id-token','firebase-refresh-token'].map(key => SecureStore.deleteItemAsync(key))).catch(() => {});
        MODULES.AppIntentsStorage?.clearAuthToken?.();
        MODULES.LiveActivityModule?.endActivity?.();
      },
      applyTheme: m => {const color = (m.colors as {background?:unknown})?.background; if(typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) {pageThemeReceived.current=true;setBackground(color);}},
      haptic: p => {void performNativeHaptic(p,sensitivity);},
      applyHapticSensitivity: n => {setSensitivity(n); void persistHapticSensitivity(n).catch(() => {});},
      requestAppleSignIn: () => {void signInApple(message.requestId);},
      requestGoogleSignIn: () => {void signInGoogle(message.requestId);},
      openUrl: url => {void WebBrowser.openBrowserAsync(url).catch(() => {});},
      recordRatingMoment: () => {void recordNativeReviewMoment();},
      startLiveActivity: m => {if(!MODULES.LiveActivityModule?.startActivity) return false; MODULES.LiveActivityModule.startActivity(m); return true;},
      updateLiveActivity: m => {if(!MODULES.LiveActivityModule?.updateActivity) return false; MODULES.LiveActivityModule.updateActivity(m); return true;},
      endLiveActivity: () => {if(!MODULES.LiveActivityModule?.endActivity) return false; MODULES.LiveActivityModule.endActivity(); return true;},
      setDashboardWidget: v => MODULES.AppIntentsStorage?.setDashboardWidgetSnapshot?.(JSON.stringify(v)),
      setDashboardWidgets: v => MODULES.AppIntentsStorage?.setDashboardWidgetSnapshots?.(JSON.stringify(v)),
      removeDashboardWidgets: id => MODULES.AppIntentsStorage?.removeDashboardWidgetSnapshots?.(id),
    },liveIndex);
  }

  function allowNavigation(request: {url:string;isTopFrame?:boolean;mainDocumentURL?:string}) {
    if (isAppOriginUrl(request.url,ORIGINS)) return true;
    // ChatRPE's subframe-only rule: never allow Firebase/reCAPTCHA as the app document.
    if(request.isTopFrame === false && isAppOriginUrl(request.mainDocumentURL,ORIGINS)) {
      try {
        const u = new URL(request.url);
        if (u.protocol === 'https:' && ((u.hostname === `${identity.firebase}.firebaseapp.com` && u.pathname.startsWith('/__/auth/')) ||
          (['www.google.com','recaptcha.google.com','www.gstatic.com'].includes(u.hostname) && u.pathname.startsWith('/recaptcha/')))) return true;
      } catch {return false;}
    }
    if(isOpenableUrl(request.url)) void WebBrowser.openBrowserAsync(request.url).catch(() => {});
    return false;
  }

  return <View style={[styles.root,{backgroundColor:background}]}>
    <StatusBar style={shellDark ? 'light' : 'dark'} />
    {failed ? <View style={styles.error}>
      <Text style={styles.title}>Can’t connect to {identity.name}</Text>
      <Text>Check your connection, then try again. Your saved data stays on this device.</Text>
      <Pressable accessibilityRole="button" onPress={() => {setFailed(false);setWebKey(k=>k+1);}} style={styles.button}><Text>Try again</Text></Pressable>
    </View> : <WebView ref={web} key={webKey} source={{uri:source}} style={{backgroundColor:background}}
      applicationNameForUserAgent={`${identity.slug}_Native/1.0`} originWhitelist={['https://*']}
      injectedJavaScriptBeforeContentLoaded={bridgeBootstrap}
      injectedJavaScriptBeforeContentLoadedForMainFrameOnly={true}
      onMessage={onMessage} onShouldStartLoadWithRequest={allowNavigation}
      onNavigationStateChange={nav => {if(nav.url && !isAppOriginUrl(nav.url,ORIGINS)) {setSource(APP_URL);setWebKey(k=>k+1);}}}
      onOpenWindow={event => {if(isOpenableUrl(event.nativeEvent.targetUrl)) void WebBrowser.openBrowserAsync(event.nativeEvent.targetUrl).catch(()=>{});}}
      onError={() => setFailed(true)} onHttpError={event => {if(event.nativeEvent.statusCode >= 400) setFailed(true);}}
      onContentProcessDidTerminate={() => setWebKey(k=>k+1)}
      onLoadEnd={() => {web.current?.injectJavaScript(bridgeBootstrap);send({type:'NATIVE_CAPABILITIES',capabilities:capabilities()});queuedDeepLink.current=null;}}
      startInLoadingState renderLoading={() => <ActivityIndicator style={StyleSheet.absoluteFill} />}
      javaScriptEnabled domStorageEnabled sharedCookiesEnabled allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false} mediaCapturePermissionGrantType="prompt"
      allowsBackForwardNavigationGestures bounces={false} contentInsetAdjustmentBehavior="never" />}
  </View>;
}
const styles = StyleSheet.create({root:{flex:1},error:{flex:1,justifyContent:'center',gap:20,padding:28,backgroundColor:'#f6f7f4'},title:{fontSize:22,fontWeight:'600'},button:{padding:16,backgroundColor:'#dededb',borderRadius:12,alignSelf:'flex-start'}});
