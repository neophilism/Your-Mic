import {MC_MODEL, MC_VOICE, type McPlan} from './mc';

type SpeechEnv = {DB?: D1Database; BUCKET?: R2Bucket; AI?: {run(model: string, input: Record<string, unknown>): Promise<ReadableStream>}; MC_CLOUDFLARE_ACCOUNT_ID?: string; MC_CLOUDFLARE_API_TOKEN?: string};
export function speechAvailable(env: SpeechEnv) {
  return !!env.AI || !!(env.MC_CLOUDFLARE_ACCOUNT_ID && env.MC_CLOUDFLARE_API_TOKEN);
}
async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), v => v.toString(16).padStart(2, '0')).join('');
}

export async function prepareMc(env: SpeechEnv, eventId: string, plan: McPlan) {
  const id = await digest(JSON.stringify([eventId, MC_MODEL, MC_VOICE, plan.context, plan.text]));
  const db = env.DB!, bucket = env.BUCKET!;
  const find = () => db.prepare('SELECT * FROM mc_clips WHERE id=? AND event_id=?').bind(id, eventId).first<any>();
  let clip = await find();
  const response = (state: string, message = '') => ({id, context: plan.context, text: plan.text, state, message, audioUrl: state === 'ready' ? `/api/mc-audio/${id}` : null});
  if (clip?.state === 'ready') return response('ready');
  if (!speechAvailable(env)) return response('unavailable', 'The MC voice activates on Cloudflare. Music can still play here.');
  const now = Date.now();
  if (clip?.lease_until > now) return response(clip.state === 'failed' ? 'failed' : 'generating', clip.state === 'failed' ? 'Speech is unavailable. The music will continue.' : '');
  const count = await db.prepare('SELECT COUNT(*) AS n FROM mc_clips WHERE event_id=? AND created_at>?').bind(eventId, now - 60000).first<any>();
  if (count.n >= 30) return response('generating', 'Preparing recent edits. The previous ready announcement stays in place.');
  const lease = crypto.randomUUID();
  const claimed = await db.prepare("INSERT INTO mc_clips(id,event_id,context,text,state,lease,lease_until,created_at) VALUES(?,?,?,?,'generating',?,?,?) ON CONFLICT(id) DO UPDATE SET state='generating',lease=excluded.lease,lease_until=excluded.lease_until WHERE mc_clips.state!='ready' AND mc_clips.lease_until<=?")
    .bind(id, eventId, plan.context, plan.text, lease, now + 30000, now, now).run();
  if (!claimed.meta.changes) return response('generating');
  const key = `mc/${eventId}/${id}.mp3`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const generation = (async () => {
      let stream: ReadableStream;
      const input = {text: plan.text, speaker: MC_VOICE, encoding: 'mp3'};
      if (env.AI) stream = await env.AI.run(MC_MODEL, input);
      else {
        const result = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.MC_CLOUDFLARE_ACCOUNT_ID!)}/ai/run/${MC_MODEL}`, {
          method: 'POST', headers: {Authorization: `Bearer ${env.MC_CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json'}, body: JSON.stringify(input), signal: AbortSignal.timeout(18000),
        });
        if (!result.ok || !result.body || (result.headers.get('content-type') || '').includes('json')) throw Error('Speech provider unavailable');
        stream = result.body;
      }
      const bytes = await new Response(stream).arrayBuffer();
      if (bytes.byteLength < 32 || bytes.byteLength > 4 * 1024 * 1024) throw Error('Invalid speech audio');
      return bytes;
    })();
    const bytes = await Promise.race([generation, new Promise<never>((_resolve, reject) => {timer = setTimeout(() => reject(Error('Speech timeout')), 20000);})]);
    await bucket.put(key, bytes, {httpMetadata: {contentType: 'audio/mpeg'}});
    await db.prepare("UPDATE mc_clips SET state='ready',audio_key=?,lease_until=0 WHERE id=? AND lease=?").bind(key, id, lease).run();
    clip = await find();
    return response(clip?.state === 'ready' ? 'ready' : 'generating');
  } catch {
    await db.prepare("UPDATE mc_clips SET state='failed',lease_until=? WHERE id=? AND lease=?").bind(Date.now() + 10000, id, lease).run();
    return response('failed', 'Speech could not be prepared. The previous ready announcement stays in place; music will continue.');
  } finally {if (timer) clearTimeout(timer);}
}
