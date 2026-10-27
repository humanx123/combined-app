import { GoogleAuthProvider, OAuthProvider, deleteUser, reauthenticateWithCredential, reauthenticateWithPopup, type Auth } from 'firebase/auth';
import { collection, doc, getDocs, limit, query, serverTimestamp, runTransaction, writeBatch, type Firestore } from 'firebase/firestore';
import { nativeAuthCredential, isNativeApp, postToNative } from './native-bridge';

/** Account deletion is intentionally separate from progress reset/sign-out.
 * A retained UID-only tombstone prevents still-valid tokens on other devices
 * from re-creating data. Owner rules permit deletion but block further writes.
 * No background cleanup job or new paid Firebase service is required.
 */
export async function deleteOwnAccount(auth:Auth, db:Firestore, options:{collections:readonly string[];documents:readonly string[];storage?:()=>Promise<void>;stopSync?:()=>void}) {
  const user=auth.currentUser;
  if(!user) throw new Error('Sign in before deleting your account.');
  const provider=user.providerData.some(p=>p.providerId==='apple.com')?'apple':'google';
  let appleCode:string|undefined;
  if(isNativeApp()) {
    const {credential,reply}=await nativeAuthCredential(provider);
    await reauthenticateWithCredential(user,credential);
    appleCode=reply.authorizationCode;
  } else {
    const result=await reauthenticateWithPopup(user,provider==='apple'?new OAuthProvider('apple.com'):new GoogleAuthProvider());
    if(provider==='apple') {
      const {revokeAccessToken}=await import('firebase/auth');
      const accessToken=OAuthProvider.credentialFromResult(result)?.accessToken;
      if(!accessToken) throw new Error('Apple did not return authorization to revoke. Please retry.');
      await revokeAccessToken(auth,accessToken);
    }
  }
  if(provider==='apple' && isNativeApp()) {
    if(!appleCode) throw new Error('Apple did not return authorization to revoke. Please retry.');
    const response=await fetch('/.netlify/functions/revoke-apple',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${await user.getIdToken(true)}`},body:JSON.stringify({authorizationCode:appleCode})});
    if(!response.ok) throw new Error('Apple authorization could not be revoked. Your account has not been deleted. Please retry or contact support.');
  }
  options.stopSync?.();
  // Written before touching data; all other devices' writes now fail closed.
  await runTransaction(db,async tx=>{const marker=doc(db,'account_deletions',user.uid);if(!(await tx.get(marker)).exists()) tx.set(marker,{requestedAt:serverTimestamp()});});
  if(options.storage) await options.storage();
  for(const name of options.collections) {
    // Bounded pages work for large libraries and stay below the 500-op cap.
    for(;;) {
      const page=await getDocs(query(collection(db,'users',user.uid,name),limit(400)));
      if(page.empty) break;
      const batch=writeBatch(db);page.docs.forEach(d=>batch.delete(d.ref));await batch.commit();
    }
  }
  const root=writeBatch(db);
  for(const name of options.documents) root.delete(doc(db,'users',user.uid,...name.split('/')));
  root.delete(doc(db,'users',user.uid));await root.commit();
  await deleteUser(user);
  postToNative({type:'AUTH_TOKEN_CLEAR'});
  return user.uid;
}
