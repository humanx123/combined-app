import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection, deleteDoc, serverTimestamp } from 'firebase/firestore';
let env;
before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run through Firebase emulators:exec.');
  env = await initializeTestEnvironment({ projectId: 'demo-vibe-tests', firestore: { rules: await readFile('firestore.rules', 'utf8') } });
});
after(async () => { await env?.cleanup(); });
const item = (id) => ({ id, name: 'Warm keys', kind: 'sound', tags: ['warm'], data: '{}', updatedAt: 1, revision: 'a', deleted: false });
test('library owners can save, list and read their items; other users and anonymous clients cannot', async () => {
  const alice = env.authenticatedContext('alice').firestore();
  const path = 'users/alice/library/sound1';
  await assertSucceeds(setDoc(doc(alice, path), item('sound1')));
  await assertSucceeds(getDoc(doc(alice, path)));
  await assertSucceeds(setDoc(doc(alice, path), { ...item('sound1'), name: 'Renamed keys', revision: 'b' }));
  await assertSucceeds(getDocs(collection(alice, 'users/alice/library')));
  const bob = env.authenticatedContext('bob').firestore();
  await assertFails(getDoc(doc(bob, path))); await assertFails(setDoc(doc(bob, path), item('sound1')));
  await assertFails(getDocs(collection(bob, 'users/alice/library')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), path)));
});
test('deletion uses owner-only tombstones and hard deletes are denied', async () => {
  const alice = env.authenticatedContext('alice').firestore(); const path = 'users/alice/library/deleted';
  await assertSucceeds(setDoc(doc(alice, path), { ...item('deleted'), deleted: true, data: '' }));
  await assertFails(deleteDoc(doc(alice, path)));
  await assertFails(setDoc(doc(alice, path), { ...item('deleted'), updatedAt: 1000 }));
});
test('library records reject unexpected fields, wrong IDs, invalid kinds and oversized payloads', async () => {
  const db = env.authenticatedContext('alice').firestore(), path = 'users/alice/library/invalid';
  for (const change of [{ id: 'other' }, { kind: 'script' }, { deleted: 'false' }, { unexpected: 'x' }, { data: 'x'.repeat(800001) }]) {
    await assertFails(setDoc(doc(db, path), { ...item('invalid'), ...change }));
  }
});
test('custom instructions remain in the owner-only preference document', async () => {
  const path = 'users/alice/prefs/main';
  const ai = { data: JSON.stringify({ customInstructions: 'Use warm keys.' }), updatedAt: 1 };
  await assertSucceeds(setDoc(doc(env.authenticatedContext('alice').firestore(), path), { ai }));
  await assertFails(getDoc(doc(env.authenticatedContext('bob').firestore(), path)));
});

test('agreement receipts require current policies, adult confirmation, and a server timestamp and stay private', async () => {
  const alice = env.authenticatedContext('alice').firestore();
  const bob = env.authenticatedContext('bob').firestore();
  const path = 'users/alice/legal/current';
  const receipt = () => ({ termsVersion: '2026-10-20', privacyVersion: '2026-10-20', adult: true, acceptedAt: serverTimestamp() });
  await assertSucceeds(setDoc(doc(alice, path), receipt()));
  await assertSucceeds(getDoc(doc(alice, path)));
  await assertFails(getDoc(doc(bob, path)));
  await assertFails(setDoc(doc(bob, path), receipt()));
  await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), path), receipt()));
  for (const patch of [{ adult:false }, { termsVersion:'old' }, { privacyVersion:'old' }, { acceptedAt:1 }, { unrelated:true }]) {
    await assertFails(setDoc(doc(alice, path), { ...receipt(), ...patch }));
  }
});
