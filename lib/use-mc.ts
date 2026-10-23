'use client';
import {useCallback, useEffect, useRef, useState} from 'react';
import {mcTrackPlan, mcSpecialPlan, type McPlan, type McKind} from './mc';
import {nextSelection} from './playback';

export type ReadyMc = {id: string; context: string; text: string; url: string; order: number};
export const upcomingMc = (s: any) => s ? mcTrackPlan(s.event, s.tracks.find((t: any) => t.id === s.event.current_track), 'track-end') : null;
export function useMc(snapshot: any, admin: boolean, request: (path: string, options?: RequestInit) => Promise<any>) {
  const current = useRef(snapshot);current.current = snapshot;
  const cache = useRef(new Map<string, ReadyMc>()), recordings = useRef(new Map<string, ReadyMc>()), inFlight = useRef(new Map<string, Promise<any>>());
  const retired = useRef(new Set<string>()), order = useRef(0);
  const [status, setStatus] = useState(''), [revision, setRevision] = useState(0);
  const eventId = snapshot?.event.id || '', voice = snapshot?.mcVoice || 'Zeus';
  const identity = useRef('');identity.current = `${eventId}:${voice}`;
  const prepare = useCallback(async (kind: McKind = 'track-end', trackId?: string, force = false, entryId?: string) => {
    const s = current.current;if (!s?.isOwner) return null;
    const track = s.tracks.find((t: any) => t.id === (trackId || s.event.current_track));
    const entry = entryId ? s.queue.find((q: any) => q.id === entryId) : null;
    const plan = kind === 'intro' || kind === 'outro' ? mcSpecialPlan(s.event, kind) : mcTrackPlan(s.event, track, kind === 'track-start' ? 'track-start' : 'track-end', entry);
    if (!plan) return null;
    const ready = cache.current.get(plan.context);
    if (!force && ready?.text === plan.text) return ready;
    const key = JSON.stringify([voice, plan.context, plan.text]);
    if (inFlight.current.has(key)) return inFlight.current.get(key);
    const generation = ++order.current, expectedIdentity = `${eventId}:${voice}`;
    const job = (async () => {
      try {
        const clip = await request(`events/${eventId}/mc`, {method: 'POST', signal: AbortSignal.timeout(30000), body: JSON.stringify({kind, trackId: track?.id, entryId})});
        if (identity.current !== expectedIdentity) return null;
        if (clip.state !== 'ready') {setStatus(clip.message || 'Preparing track clips. Music continues if a recording is unavailable.');return null;}
        if (cache.current.get(clip.context)?.id === clip.id) return cache.current.get(clip.context)!;
        // Fully download during a song, never request TTS at a music boundary.
        const response = await fetch(clip.audioUrl, {signal: AbortSignal.timeout(15000)});
        if (!response.ok || !(response.headers.get('content-type') || '').startsWith('audio/')) throw Error('Could not load announcement');
        const blob = await response.blob(), expected = Number(response.headers.get('content-length'));
        if (!blob.size || expected > 0 && blob.size !== expected) throw Error('Incomplete announcement');
        const url = URL.createObjectURL(blob);
        try {
          await new Promise<void>((resolve, reject) => {
            const audio = new Audio();let finished = false;
            const finish = (ok: boolean) => {if (finished) return;finished = true;clearTimeout(timer);audio.onloadedmetadata = null;audio.onerror = null;audio.removeAttribute('src');audio.load();ok ? resolve() : reject(Error('Invalid announcement audio'));};
            const timer = setTimeout(() => finish(false), 5000);
            audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) && audio.duration > 0 && audio.duration < 120);
            audio.onerror = () => finish(false);audio.preload = 'metadata';audio.src = url;
          });
          const previous = cache.current.get(clip.context);
          if (identity.current !== expectedIdentity || previous && previous.order > generation) {URL.revokeObjectURL(url);return previous || null;}
          const ready = {id: clip.id, context: clip.context, text: clip.text, url, order: generation};
          retired.current.add(url);cache.current.set(clip.context, ready);recordings.current.set(clip.id, ready);
          // Keep all opening/closing clips for a full 100-track set, plus queue
          // callouts. Do not evict the currently playing recording during edits.
          if (retired.current.size > 420) for (const old of retired.current) {
            if (retired.current.size <= 400) break;
            if (old === url || [...document.querySelectorAll('audio')].some(a => a.src === old && !a.paused)) continue;
            for (const [context, value] of cache.current) if (value.url === old) cache.current.delete(context);
            for (const [id, value] of recordings.current) if (value.url === old) recordings.current.delete(id);
            URL.revokeObjectURL(old);retired.current.delete(old);
          }
          setRevision(v => v + 1);setStatus('Track opening and closing clips ready');return ready;
        } catch (error) {URL.revokeObjectURL(url);throw error;}
      } catch {setStatus('Some MC clips are unavailable. Previous ready recordings stay in place; music continues.');return null;}
      finally {inFlight.current.delete(key);}
    })();
    inFlight.current.set(key, job);return job;
  }, [eventId, voice, request]);
  useEffect(() => {
    cache.current.clear();recordings.current.clear();inFlight.current.clear();setStatus('');
    return () => {for (const url of retired.current) URL.revokeObjectURL(url);retired.current.clear();};
  }, [eventId, voice]);
  const enabled = admin && snapshot?.isOwner && snapshot.speechAvailable;
  const catalogKey = snapshot ? JSON.stringify([snapshot.event.artist, snapshot.event.album, snapshot.event.title, snapshot.event.mc_enabled, snapshot.event.intro_enabled, snapshot.event.intro_text, snapshot.event.outro_enabled, snapshot.event.outro_text, snapshot.tracks.map((t: any) => [t.id, t.title, t.position, t.mc_text, t.mc_intro_text])]) : '';
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false, running = false;
    const run = async () => {
      if (running) return;running = true;
      try {
        const s = current.current;
        const jobs: Array<[McKind, string?]> = [...(s.event.intro_enabled ? [['intro'] as [McKind]] : []), ...(s.event.outro_enabled ? [['outro'] as [McKind]] : []), ...(s.event.mc_enabled ? s.tracks.flatMap((t: any) => [['track-start', t.id], ['track-end', t.id]]) : [])];
        // The current pair is prioritized by the effect below. Catalog jobs
        // stop at the provider throttle and retry later instead of busy polling.
        for (const [kind, track] of jobs) {if (cancelled) return;if (!await prepare(kind, track)) break;}
      } finally {running = false;}
    };
    void run();const timer = setInterval(run, 15000);return () => {cancelled = true;clearInterval(timer);};
  }, [enabled, catalogKey, prepare]);
  const queueKey = snapshot ? JSON.stringify(snapshot.queue.map((q: any) => [q.id, q.track_id, q.name])) : '';
  const currentTrack = snapshot?.event.current_track || '';
  const next = snapshot ? nextSelection(snapshot.event, snapshot.tracks, snapshot.queue) : null;
  const priorityKey = JSON.stringify([currentTrack, next?.track?.id, next?.entry?.id, catalogKey]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const run = async () => {
      const s = current.current;
      if (s.event.current_track) await prepare('track-end', s.event.current_track);
      const pick = nextSelection(s.event, s.tracks, s.queue);
      if (pick.track) await prepare('track-start', pick.track.id, false, pick.entry?.id);
      for (const entry of s.queue) {if (cancelled) return;if (!await prepare('track-start', entry.track_id, false, entry.id)) break;}
    };
    void run();const timer = setInterval(run, 12000);return () => {cancelled = true;clearInterval(timer);};
  }, [enabled, priorityKey, queueKey, prepare]);
  const get = (plan: McPlan | null) => plan ? cache.current.get(plan.context) || null : null;
  const boundary = (s: any, action: string, trackId?: string) => {
    const e = s.event;
    const pick = action === 'select' ? {track: s.tracks.find((t: any) => t.id === trackId), entry: null} : action === 'finish-announcement' && e.announcement_kind === 'intro' ? {track: s.tracks.find((t: any) => t.id === e.current_track), entry: s.queue.find((q: any) => q.id === e.current_entry)} : nextSelection(e, s.tracks, s.queue);
    const generic = mcTrackPlan(e, pick.track, 'track-start');
    return {splitMc: true, closingClipId: get(upcomingMc(s))?.id, openingClipId: get(mcTrackPlan(e, pick.track, 'track-start', pick.entry))?.id, genericOpeningClipId: get(generic)?.id,
      // The server can select a just-arrived queue song after this request was
      // formed. All ready generic introductions are safe for that actual pick.
      trackOpeningClips: Object.fromEntries(s.tracks.map((t: any) => [t.id, get(mcTrackPlan(e, t, 'track-start'))?.id]).filter((x: any[]) => x[1])),
      introClipId: get(mcSpecialPlan(e, 'intro'))?.id, outroClipId: get(mcSpecialPlan(e, 'outro'))?.id};
  };
  return {status, revision, prepare, get, boundary, readyClips: () => [...recordings.current.values()], special: (kind: 'intro' | 'outro') => get(current.current ? mcSpecialPlan(current.current.event, kind) : null), audioSrc: (id: string) => recordings.current.get(id)?.url || `/api/mc-audio/${id}`};
}
