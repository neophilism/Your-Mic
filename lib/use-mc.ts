'use client';
import {useCallback, useEffect, useRef, useState} from 'react';
import {mcPlan, mcPreparationKey, mcSpecialPlan, type McPlan} from './mc';
import {nextSelection} from './playback';

export type ReadyMc = {id: string; context: string; text: string; url: string; order: number};
export function upcomingMc(snapshot: any): McPlan | null {
  return snapshot ? mcPlan(snapshot.event, snapshot.tracks, nextSelection(snapshot.event, snapshot.tracks, snapshot.queue)) : null;
}

export function useMc(snapshot: any, admin: boolean, request: (path: string, options?: RequestInit) => Promise<any>) {
  const current = useRef(snapshot); current.current = snapshot;
  const cache = useRef(new Map<string, ReadyMc>()), inFlight = useRef(new Map<string, Promise<any>>());
  const recordings = useRef(new Map<string, ReadyMc>());
  const order = useRef(0), activeEvent = useRef('');
  const [status, setStatus] = useState(''), [revision, setRevision] = useState(0);
  const eventId = snapshot?.event.id || '';
  const voice = snapshot?.mcVoice || 'Zeus';
  const activeVoice = useRef(voice);activeVoice.current = voice;
  activeEvent.current = eventId;
  const prepare = useCallback(async (kind: 'between' | 'intro' | 'outro' = 'between', trackId?: string, force = false) => {
    if (!eventId || !current.current?.isOwner) return null;
    const s = current.current;
    const requestKey = JSON.stringify([voice, kind, trackId, force ? ++order.current : null, kind === 'between' ? mcPreparationKey(s.event, s.tracks, nextSelection(s.event, s.tracks, s.queue)) : mcSpecialPlan(s.event, kind).text]);
    if (inFlight.current.has(requestKey)) return inFlight.current.get(requestKey);
    const generationOrder = ++order.current;
    const job = (async () => {
      if (kind === 'between') setStatus('Preparing announcement…');
      try {
        const clip = await request(`events/${eventId}/mc`, {method: 'POST', body: JSON.stringify({kind, trackId})});
        if (activeEvent.current !== eventId || activeVoice.current !== voice) return null;
        if (clip.state !== 'ready') {
          if (kind === 'between') setStatus(clip.message || (clip.state === 'idle' ? '' : 'Preparing announcement. Previous ready audio stays in place.'));
          return null;
        }
        const existing = cache.current.get(clip.context);
        if (existing?.id === clip.id) {if (kind === 'between') setStatus('Announcement ready');return existing;}
        // Download the complete recording during the song. Never fetch TTS at a boundary.
        const response = await fetch(clip.audioUrl, {signal: AbortSignal.timeout(10000)});
        if (!response.ok) throw Error('Could not load announcement');
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        try {
          await new Promise<void>((resolve, reject) => {
            const audio = new Audio(); const timer = setTimeout(() => {audio.removeAttribute('src'); reject(Error('Audio not ready'));}, 4000);
            const finish = (ok: boolean) => {clearTimeout(timer);audio.removeAttribute('src');audio.load();ok ? resolve() : reject(Error('Invalid announcement audio'));};
            audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) && audio.duration > 0 && audio.duration < 120);
            audio.onerror = () => finish(false);audio.preload = 'auto';audio.src = url;
          });
          const ready = {id: clip.id, context: clip.context, text: clip.text, url, order: generationOrder};
          const previous = cache.current.get(clip.context);
          if (activeEvent.current !== eventId || activeVoice.current !== voice || (previous && previous.order > generationOrder)) {URL.revokeObjectURL(url);return previous || null;}
          // Retain old URLs until event cleanup: one may already be on the speaker.
          retired.current.add(url);recordings.current.set(clip.id, ready);
          if (retired.current.size > 40) for (const oldUrl of retired.current) {
            if (retired.current.size <= 30) break;
            if (oldUrl === url || [...document.querySelectorAll('audio')].some(audio => audio.src === oldUrl && !audio.paused)) continue;
            for (const [context, clip] of cache.current) if (clip.url === oldUrl) cache.current.delete(context);
            for (const [id, recording] of recordings.current) if (recording.url === oldUrl) recordings.current.delete(id);
            URL.revokeObjectURL(oldUrl);retired.current.delete(oldUrl);
          }
          cache.current.set(clip.context, ready);
          if (cache.current.size > 30) cache.current.delete(cache.current.keys().next().value!);
          setRevision(value => value + 1);
          if (kind === 'between') setStatus('Announcement ready');
          return ready;
        } catch (error) {URL.revokeObjectURL(url);throw error;}
      } catch {
        if (kind === 'between') setStatus('Announcement unavailable. Music will continue; any previous ready recording stays in place.');
        return null;
      } finally {inFlight.current.delete(requestKey);}
    })();
    inFlight.current.set(requestKey, job);
    return job;
  }, [eventId, voice, request]);
  const retired = useRef(new Set<string>());
  useEffect(() => {
    cache.current.clear();recordings.current.clear();inFlight.current.clear();setStatus('');
    return () => {for (const url of retired.current) URL.revokeObjectURL(url);retired.current.clear();};
  }, [eventId, voice]);
  const key = snapshot ? mcPreparationKey(snapshot.event, snapshot.tracks, nextSelection(snapshot.event, snapshot.tracks, snapshot.queue)) : '';
  useEffect(() => {
    if (!admin || !snapshot?.isOwner) return;
    if (!snapshot.speechAvailable) {setStatus('The MC voice activates on Cloudflare. Music can still play here.');return;}
    if (!key) {setStatus('');return;}
    prepare();const timer = setInterval(() => prepare(), 12000);return () => clearInterval(timer);
  }, [key, admin, snapshot?.isOwner, snapshot?.speechAvailable, prepare]);
  useEffect(() => {if (admin && snapshot?.isOwner && snapshot.speechAvailable && snapshot.event.intro_enabled) prepare('intro');}, [admin, snapshot?.isOwner, snapshot?.speechAvailable, snapshot?.event.intro_enabled, snapshot?.event.intro_text, snapshot?.event.artist, snapshot?.event.album, snapshot?.event.title, prepare]);
  useEffect(() => {if (admin && snapshot?.isOwner && snapshot.speechAvailable && snapshot.event.outro_enabled) prepare('outro');}, [admin, snapshot?.isOwner, snapshot?.speechAvailable, snapshot?.event.outro_enabled, snapshot?.event.outro_text, snapshot?.event.artist, snapshot?.event.album, snapshot?.event.title, prepare]);
  // Ask the browser to warm the next music file while the current one plays.
  useEffect(() => {
    if (!admin || !snapshot?.speakerHere || !snapshot?.event.current_track || snapshot.event.show_ended) return;
    const pick = nextSelection(snapshot.event, snapshot.tracks, snapshot.queue);
    if (!pick.track) return;
    const audio = new Audio(`/api/audio/${pick.track.id}${pick.entry ? '?beat=1' : ''}`);audio.preload = 'auto';audio.load();
    return () => {audio.removeAttribute('src');audio.load();};
  }, [key, admin, snapshot?.speakerHere, snapshot?.event.current_track, snapshot?.event.show_ended]);
  const get = (plan: McPlan | null) => plan ? cache.current.get(plan.context) || null : null;
  return {status, revision, prepare, get, special: (kind: 'intro' | 'outro') => get(current.current ? mcSpecialPlan(current.current.event, kind) : null), audioSrc: (id: string) => recordings.current.get(id)?.url || `/api/mc-audio/${id}`};
}
