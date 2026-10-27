import fs from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,deleteDoc,serverTimestamp} from 'firebase/firestore';
import {ref,uploadBytes,listAll,deleteObject} from 'firebase/storage';
const environment=await initializeTestEnvironment({projectId:'demo-native-deletion',firestore:{rules:fs.readFileSync('firestore.rules','utf8')},storage:{rules:fs.readFileSync('storage.rules','utf8')}});
try {
 await environment.clearFirestore();
 const fresh=environment.authenticatedContext('owner',{auth_time:Math.floor(Date.now()/1000)}).firestore();
 const other=environment.authenticatedContext('attacker',{auth_time:Math.floor(Date.now()/1000)}).firestore();
 const stale=environment.authenticatedContext('stale',{auth_time:Math.floor(Date.now()/1000)-3600}).firestore();
 const storage=environment.authenticatedContext('owner',{auth_time:Math.floor(Date.now()/1000)}).storage();
 const audio=ref(storage,'users/owner/samples/clip');
 await assertSucceeds(uploadBytes(audio,new Uint8Array([1,2,3]),{contentType:'audio/wav'}));
 await assertSucceeds(listAll(ref(storage,'users/owner/samples')));
 await assertFails(setDoc(doc(other,'account_deletions','owner'),{requestedAt:serverTimestamp()}));
 await assertFails(setDoc(doc(stale,'account_deletions','stale'),{requestedAt:serverTimestamp()}));
 await assertSucceeds(setDoc(doc(fresh,'account_deletions','owner'),{requestedAt:serverTimestamp()}));
 await assertFails(uploadBytes(ref(storage,'users/owner/samples/restore'),new Uint8Array([1]),{contentType:'audio/wav'}));
 await assertSucceeds(listAll(ref(storage,'users/owner/samples')));
 await assertSucceeds(deleteObject(audio));
 await assertFails(deleteDoc(doc(fresh,'account_deletions','owner')));
 await assertFails(setDoc(doc(fresh,'account_deletions','owner'),{requestedAt:serverTimestamp()}));
 await assertFails(getDoc(doc(other,'account_deletions','owner')));
 await environment.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();
  await setDoc(doc(db,'users','owner'),{email:'private@example.com'});
  await setDoc(doc(db,'users','owner','library','item'),{id:'item'});
 });
 await assertFails(setDoc(doc(fresh,'users','owner'),{email:'restore@example.com'}));
 await assertSucceeds(deleteDoc(doc(fresh,'users','owner')));
 await assertSucceeds(deleteDoc(doc(fresh,'users','owner','library','item')));await assertFails(setDoc(doc(fresh,'users','owner','samples','item'),{id:'item'}));
 console.log('Account deletion rules: ownership, recent auth, immutable tombstone, deletion, and no resurrection passed.');
} finally {await environment.cleanup();}
