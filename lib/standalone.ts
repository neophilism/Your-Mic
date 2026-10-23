import {api} from './api';

declare global {
  namespace Cloudflare {
    interface Env {
      ARTIST_PASSWORD?: string;
      SESSION_SECRET?: string;
    }
  }
}

const cookieName = '__Host-ym-artist';
const lifetime = 12 * 60 * 60;
const encoder = new TextEncoder();
const response = (body: string, status = 200, extra: HeadersInit = {}) => new Response(body, {
  status,
  headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", ...extra},
});
const page = (message = '') => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Artist sign-in — Your Mic</title><style>body{background:#111411;color:#fafbf6;font:18px system-ui;margin:0;display:grid;min-height:100svh;place-items:center}main{max-width:380px;padding:32px}h1{font-size:46px;line-height:1.1}label,input,button{display:block}input{box-sizing:border-box;width:100%;font:inherit;padding:14px;margin:12px 0 20px;border-radius:8px}button{background:#c9f54b;border:0;border-radius:8px;padding:14px 24px;font:inherit;font-weight:700;cursor:pointer}a{color:#c9f54b}p{line-height:1.5}.error{color:#ffb0a5}</style><main><small>YOUR MIC · ARTIST STUDIO</small><h1>Your set.<br>Their moment.</h1><p>Sign in to manage the event and speaker. Audience members never need an account.</p>${message ? `<p class="error" role="alert">${message}</p>` : ''}<form method="post" action="/artist/sign-in"><label for="password">Artist password</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="1024" required><button type="submit">Sign in</button></form><p><a href="/">Back to the event</a></p></main></html>`;
const signoutPage = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Sign out — Your Mic</title><form method="post" action="/artist/sign-out"><button type="submit">Sign out of the artist studio</button></form></html>';

function encode(bytes: Uint8Array) {return btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');}
function decode(value: string) {return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));}
async function key(secret: string) {return crypto.subtle.importKey('raw', encoder.encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign', 'verify']);}
async function sign(value: string, secret: string) {return encode(new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(value))));}
async function passwordMatches(input: string, expected: string) {
  const hashes = await Promise.all([input, expected].map(v => crypto.subtle.digest('SHA-256', encoder.encode(v))));
  const a = new Uint8Array(hashes[0]), b = new Uint8Array(hashes[1]);
  let difference = 0; for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
async function signedIn(request: Request, secret: string) {
  const token = request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  if (!token || token.length > 4096) return false;
  try {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra || !await crypto.subtle.verify('HMAC', await key(secret), decode(signature), encoder.encode(payload))) return false;
    const session = JSON.parse(new TextDecoder().decode(decode(payload)));
    return session.artist === 'standalone-artist' && Number.isSafeInteger(session.exp) && session.exp > Math.floor(Date.now()/1000) && session.exp <= Math.floor(Date.now()/1000)+lifetime;
  } catch {return false;}
}
function sameOrigin(request: Request) {
  return request.headers.get('origin') === new URL(request.url).origin && request.headers.get('sec-fetch-site') !== 'cross-site';
}

// Every externally supplied identity header is removed. Only a verified cookie
// may establish artist identity outside the trusted Sites hosting gateway.
export async function standaloneFetch(request: Request, env: Cloudflare.Env, fallback: (request: Request) => Promise<Response>) {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) if (name.toLowerCase().startsWith('oai-')) headers.delete(name);
  // Sanitize framework requests too, including encoded paths handled by routing.
  if (url.pathname === '/healthz') {
    try {await env.DB!.prepare('SELECT 1').first();return Response.json({ok:!!env.BUCKET}, {status:env.BUCKET?200:503,headers:{'Cache-Control':'no-store'}});}
    catch {return Response.json({ok:false}, {status:503,headers:{'Cache-Control':'no-store'}});}
  }
  const login = ['/artist/sign-in', '/signin-with-chatgpt'].includes(url.pathname);
  const logout = ['/artist/sign-out', '/signout-with-chatgpt'].includes(url.pathname);
  if (!login && !logout && !url.pathname.startsWith('/api/')) return fallback(new Request(request, {headers}));
  const configured = !!env.ARTIST_PASSWORD && env.ARTIST_PASSWORD.length >= 16 && !!env.SESSION_SECRET && env.SESSION_SECRET.length >= 32;
  const authenticated = configured && await signedIn(request, env.SESSION_SECRET!);
  if (login || logout) {
    if (!configured) return response(page('Artist sign-in needs to be configured by the host.'), 503);
    if (!['GET','POST'].includes(request.method)) return response('Method not allowed.', 405, {Allow:'GET, POST'});
    if (request.method === 'GET') return login && authenticated ? response('',303,{Location:'/admin'}) : response(login?page():signoutPage);
    if (!sameOrigin(request)) return response('Please submit this form directly from Your Mic.',403);
    if (logout) return response('',303,{Location:'/', 'Set-Cookie':`${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`});
    if (Number(request.headers.get('content-length')||0) > 8192) return response(page('That request is too large.'),413);
    const raw = await request.text();
    if (encoder.encode(raw).length > 8192) return response(page('That request is too large.'),413);
    // A fixed 15-minute window, enforced atomically in D1 across all isolates.
    const window = Math.floor(Date.now()/900000);
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const fingerprint = await sign(`login:${ip}`,env.SESSION_SECRET!);
    const attempt = await env.DB!.prepare('INSERT INTO artist_login_attempts(fingerprint,window,attempts) VALUES(?,?,1) ON CONFLICT(fingerprint) DO UPDATE SET window=excluded.window,attempts=CASE WHEN artist_login_attempts.window=excluded.window THEN artist_login_attempts.attempts+1 ELSE 1 END WHERE artist_login_attempts.window<>excluded.window OR artist_login_attempts.attempts<20').bind(fingerprint,window).run();
    if (!attempt.meta.changes) return response(page('Too many sign-in attempts. Wait 15 minutes and try again.'),429,{'Retry-After':'900'});
    // Keep the abuse table bounded over time; never store raw IP addresses.
    if (Math.random()<0.05) await env.DB!.prepare('DELETE FROM artist_login_attempts WHERE window<?').bind(window-96).run();
    const input = new URLSearchParams(raw).get('password') || '';
    if (!await passwordMatches(input,env.ARTIST_PASSWORD!)) return response(page('That password did not match.'),401);
    const payload = encode(encoder.encode(JSON.stringify({artist:'standalone-artist',exp:Math.floor(Date.now()/1000)+lifetime})));
    const token = payload+'.'+await sign(payload,env.SESSION_SECRET!);
    return response('',303,{Location:'/admin','Set-Cookie':`${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${lifetime}`});
  }
  if (authenticated) {
    headers.set('oai-authenticated-user-id','standalone-artist');
    headers.set('oai-authenticated-user-email','Artist');
  }
  if (url.pathname === '/api/me') return Response.json({signedIn:authenticated,name:authenticated?'Artist':'',signInUrl:'/artist/sign-in',signOutUrl:'/artist/sign-out',signInLabel:'Sign in as artist'}, {headers:{'Cache-Control':'no-store'}});
  return api(new Request(request,{headers}));
}
