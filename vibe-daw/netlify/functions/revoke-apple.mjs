import {createPrivateKey,sign} from 'node:crypto';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import identity from '../../mobile/app-identity.json' with {type:'json'};

const firebaseKeys=createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
const appleKeys=createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
const reply=(statusCode)=>({statusCode,headers:{'Cache-Control':'no-store','Content-Type':'application/json'},body:JSON.stringify({success:statusCode===200})});

// iOS delivers an authorization code, not Apple's access token. Exchange it only
// on the server, verify Apple's subject matches the freshly reauthenticated
// Firebase user, then revoke it. Never log codes, ID tokens, or Apple's key.
export async function handler(event) {
  if(event.httpMethod!=='POST') return reply(405);
  const auth=event.headers.authorization;
  const origin=event.headers.origin;
  if(!identity.firebase || !identity.bundle || !identity.domain) return reply(503);
  if(origin && ![`https://${identity.domain}`,`https://www.${identity.domain}`].includes(origin)) return reply(403);
  if(!auth?.startsWith('Bearer ') || (event.body?.length || 0)>4096) return reply(401);
  try {
    const {payload}=await jwtVerify(auth.slice(7),firebaseKeys,{audience:identity.firebase,issuer:`https://securetoken.google.com/${identity.firebase}`,algorithms:['RS256']});
    const appleUser=payload.firebase?.identities?.['apple.com']?.[0];
    if(!appleUser || typeof payload.auth_time!=='number' || Math.abs(Date.now()/1000-payload.auth_time)>300) return reply(401);
    const {authorizationCode}=JSON.parse(event.body || '{}');
    if(typeof authorizationCode!=='string' || authorizationCode.length<10 || authorizationCode.length>2048) return reply(400);
    const key=process.env.APPLE_SIGN_IN_PRIVATE_KEY;
    const keyId=process.env.APPLE_SIGN_IN_KEY_ID;
    if(!key || !keyId) return reply(503);
    const now=Math.floor(Date.now()/1000);
    const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned=encode({alg:'ES256',kid:keyId})+'.'+encode({iss:'FRW37USW79',iat:now,exp:now+300,aud:'https://appleid.apple.com',sub:identity.bundle});
    const signature=sign('sha256',Buffer.from(unsigned),{key:createPrivateKey(key.replace(/\\n/g,'\n')),dsaEncoding:'ieee-p1363'}).toString('base64url');
    const clientSecret=unsigned+'.'+signature;
    const tokenResponse=await fetch('https://appleid.apple.com/auth/token',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:identity.bundle,client_secret:clientSecret,code:authorizationCode,grant_type:'authorization_code'})});
    if(!tokenResponse.ok) return reply(502);
    const token=await tokenResponse.json();
    const apple=await jwtVerify(token.id_token,appleKeys,{issuer:'https://appleid.apple.com',audience:identity.bundle,algorithms:['RS256']});
    if(apple.payload.sub!==appleUser || typeof token.access_token!=='string') return reply(403);
    const revoked=await fetch('https://appleid.apple.com/auth/revoke',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:identity.bundle,client_secret:clientSecret,token:token.refresh_token || token.access_token,token_type_hint:token.refresh_token?'refresh_token':'access_token'})});
    return reply(revoked.ok?200:502);
  } catch {return reply(401);}
}
