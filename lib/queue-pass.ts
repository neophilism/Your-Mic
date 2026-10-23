// Anonymous queue identity. The private link is a bearer pass, never a public
// event link. Keep it in a fragment so it is not sent in HTTP URLs or referrers.
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
type StorageLike = {getItem(key: string): string|null; setItem(key: string,value: string): void};
export type PassBrowser = {
  storage(): StorageLike;
  cookies(): string;
  setCookie(value: string): void;
  newId(): string;
};
export function readSaved(browser: PassBrowser, key: string) {
  try {return browser.storage().getItem(key);} catch {return null;}
}
export function saveValue(browser: PassBrowser, key: string, value: string) {
  try {browser.storage().setItem(key,value);return browser.storage().getItem(key)===value;} catch {return false;}
}
function cookie(browser: PassBrowser, name: string) {
  try {return browser.cookies().split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1)||null;} catch {return null;}
}
function persistCookie(browser: PassBrowser, name: string, value: string) {
  try {
    browser.setCookie(`${name}=${value}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`);
    return cookie(browser,name)===value;
  } catch {return false;}
}
export function recoveryPass(hash: string, eventId: string) {
  const value = new URLSearchParams(hash.replace(/^#/, '')).get('queue-pass')||'';
  const [version,event,pass,extra] = value.split(':');
  return version==='v1' && event===eventId && uuid.test(event) && uuid.test(pass||'') && !extra ? pass : null;
}
export function loadQueuePass(browser: PassBrowser, eventId: string, hash = '') {
  if (!uuid.test(eventId)) throw new Error('Invalid event queue pass.');
  const key='ym-queue-'+eventId, restored=recoveryPass(hash,eventId);
  // Legacy identity preserves places created before per-event queue passes.
  const candidates=[restored,readSaved(browser,key),cookie(browser,key),readSaved(browser,'ym-guest')];
  const token=candidates.find((v):v is string=>!!v&&uuid.test(v))||browser.newId();
  const stored=saveValue(browser,key,token),cookieStored=persistCookie(browser,key,token);
  return {token,durable:stored||cookieStored,restored:!!restored};
}
export function privateQueueLink(origin: string, eventId: string, token: string) {
  if (!uuid.test(eventId)||!uuid.test(token)) throw new Error('Invalid queue pass.');
  const url=new URL('/',origin);
  url.searchParams.set('event',eventId);
  url.hash=new URLSearchParams({'queue-pass':`v1:${eventId}:${token}`}).toString();
  return url.href;
}
export function rememberQueueEvent(browser: PassBrowser,eventId: string) {
  if (!uuid.test(eventId)) return;
  saveValue(browser,'ym-last-queue',eventId);
  persistCookie(browser,'ym-last-queue',eventId);
}
export function lastQueueEvent(browser: PassBrowser) {
  const value=readSaved(browser,'ym-last-queue')||cookie(browser,'ym-last-queue');
  return value&&uuid.test(value)?value:null;
}
