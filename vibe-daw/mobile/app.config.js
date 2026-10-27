const identity = require('./app-identity.json');
const googleClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || identity.googleIosClientId;
module.exports = {
  name: identity.name, slug: identity.slug, owner: 'crisj', version: '1.0.0',
  platforms: ['ios'], scheme: identity.scheme, icon: './assets/icon.png',
  orientation: 'default', userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: identity.bundle, supportsTablet: true, usesAppleSignIn: true,
    appleTeamId: 'FRW37USW79',
    associatedDomains: ['applinks:' + identity.domain, 'applinks:www.' + identity.domain],
    config: {usesNonExemptEncryption: false},
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSAppTransportSecurity: {NSAllowsArbitraryLoads: false},
      ...(identity.mic ? {NSMicrophoneUsageDescription: 'Record audio and voice messages in Vibe when you choose the microphone.'} : {}),
      CFBundleURLTypes: [{CFBundleURLSchemes: [identity.scheme, identity.bundle,
        ...(googleClientId ? ['com.googleusercontent.apps.' + googleClientId.replace('.apps.googleusercontent.com', '')] : [])]}],
    },
  },
  extra: {eas: {projectId: identity.project}},
  plugins: ['expo-apple-authentication', 'expo-secure-store', 'expo-web-browser', 'expo-notifications',
    ['expo-splash-screen', {image:'./assets/icon.png',imageWidth:160,backgroundColor:identity.background}],
    './plugins/withNativeShortcuts'],
};
