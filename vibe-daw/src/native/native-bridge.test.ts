
import {afterEach,describe,expect,it,vi} from 'vitest';
import {appOriginsFor} from '../../mobile/bridge/bridge-urls';
import {parseTrustedWebMessage} from '../../mobile/bridge/webview-message-routing';
import {requestNative} from './native-bridge';
afterEach(()=>vi.unstubAllGlobals());
describe('native bridge trust boundary',()=>{
 it('admits only exact owned origins before parsing privileged requests',()=>{
  const origins=appOriginsFor('https://example.com/studio');
  for(const url of ['https://example.com.evil.test/','https://evil.test/example.com','http://example.com','https://preview.example.com','about:blank',''])
    expect(parseTrustedWebMessage(url,'{"type":"AUTH_TOKEN_UPDATE","token":"attacker"}',origins).accepted).toBe(false);
  expect(parseTrustedWebMessage('https://www.example.com/path','{"type":"appleSignIn"}',origins).accepted).toBe(true);
  for(const body of ['null','[]','"appleSignIn"','{'])expect(parseTrustedWebMessage('https://example.com',body,origins).accepted).toBe(false);
 });
 it('ignores foreign-frame replies and replies for another auth request',async()=>{
  const target=Object.assign(new EventTarget(),{location:{origin:'https://example.com'},__NATIVE_APP__:true,ReactNativeWebView:{postMessage:vi.fn()}});
  vi.stubGlobal('window',target);
  let finished=false;
  const pending=requestNative('appleSignIn','appleSignInResult').then(v=>{finished=true;return v;});
  const sent=JSON.parse(target.ReactNativeWebView.postMessage.mock.calls[0][0]);
  target.dispatchEvent(new MessageEvent('message',{origin:'https://evil.test',data:{type:'appleSignInResult',requestId:sent.requestId,identityToken:'bad'}}));
  target.dispatchEvent(new MessageEvent('message',{origin:'https://example.com',data:{type:'appleSignInResult',requestId:'wrong',identityToken:'bad'}}));
  await Promise.resolve();expect(finished).toBe(false);
  target.dispatchEvent(new MessageEvent('message',{origin:'https://example.com',data:{type:'appleSignInResult',requestId:sent.requestId,identityToken:'expected'}}));
  expect((await pending).identityToken).toBe('expected');
 });
});
