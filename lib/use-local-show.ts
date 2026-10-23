'use client';
import {useCallback, useEffect, useRef, useState, type MutableRefObject} from 'react';
import {BrowserLocalStore, audioKey, downloadShow, lockLocalShow, readLocalAudio, removeSavedShow, showFingerprint, showKey, validateDeviceAudio, verifySavedShow, type SavedShow} from './local-audio';
import {LocalShow, type LocalCheckpoint, type LocalClip} from './local-show';
import {mcTrackPlan, type McPlan} from './mc';

export function useLocalShow(options: {snapshot: any; admin: boolean; manager: MutableRefObject<LocalShow | null>; controller: MutableRefObject<string>; request: (path: string, options?: RequestInit) => Promise<any>; publish: (snapshot: any) => void; position: () => number; onConflict: () => void; mc: any}) {
  const {snapshot, admin, manager, controller, request, publish, mc} = options;
  const current = useRef(options); current.current = options;
  const store = useRef(new BrowserLocalStore()), saved = useRef<SavedShow | null>(null), release = useRef<(() => void) | null>(null);
  const download = useRef<AbortController | null>(null), syncing = useRef<Promise<void> | null>(null), savingClip = useRef(new Set<string>());
  const [prepared, setPrepared] = useState<SavedShow | null>(null), [hasDownload, setHasDownload] = useState(false), [preparing, setPreparing] = useState(false), [progress, setProgress] = useState(''), [message, setMessage] = useState(''), [persistent, setPersistent] = useState<boolean | null>(null);
  const owner = admin && snapshot?.isOwner ? snapshot.artistStorageKey || '' : '', eventId = snapshot?.event.id || '', fingerprint = snapshot ? showFingerprint(snapshot.tracks) : '';
  const publishShow = () => {if (manager.current) publish({...manager.current.snapshot, event: {...manager.current.snapshot.event}, queue: [...manager.current.snapshot.queue]});};
  const checkpoint = async () => {const show = manager.current, manifest = saved.current;if (show && manifest) {show.setPosition(current.current.position());await store.current.put('checkpoints', manifest.key, show.checkpoint(controller.current));}};
  const conflict = () => {manager.current = null;release.current?.();release.current = null;current.current.onConflict();setMessage('The local show reservation was reset. Audio has stopped on this device.');};
  const sync = useCallback(async () => {
    if (syncing.current) return syncing.current;
    const show = manager.current;
    if (!show) return;
    const job = (async () => {
      const report = show.report(current.current.position());
      // Storage failures must not cut the running audio. Report them separately.
      try {await checkpoint();} catch {setMessage('Music continues, but this browser could not save its latest resume position.');}
      try {
        const remote = await request(`events/${show.snapshot.event.id}/control`, {method: 'POST', signal: AbortSignal.timeout(8000), body: JSON.stringify({action: 'local-report', controller: controller.current, localSession: show.session, ...report})});
        if (manager.current !== show) return;
        if (remote.localSession !== show.session) {conflict();return;}
        show.acknowledge(report); show.merge(remote); publishShow();
        setMessage('Saved audio is playing on this device. Queue updates are connected.');
        await checkpoint().catch(() => {});
      } catch (error: any) {
        if (manager.current !== show) return;
        if (error.status === 409 || error.status === 403) conflict();
        else setMessage(error.status === 401 ? 'Saved audio continues. Sign in again when convenient to restore queue updates.' : 'Offline playback continues. New queue requests and MC edits will sync when the connection returns.');
        throw error;
      }
    })();
    syncing.current = job;
    try {await job;} finally {if (syncing.current === job) syncing.current = null;}
  }, [request, manager, controller, publish]);

  const findClip = (plan: McPlan | null, pick?: any): LocalClip | null => {
    if (!plan) return null;
    const live = current.current.mc.get(plan);
    if (live) return {...live, source: live.url};
    if (saved.current?.voiceKey !== (current.current.snapshot?.mcVoiceKey || current.current.snapshot?.mcVoice || 'Zeus')) return null;
    let clip = saved.current?.clips.find(c => c.context === plan.context);
    // A generic playlist recording may be reused only when it names no rapper
    // and the actual next track is the same. Never call the wrong performer.
    if (!clip && plan.kind === 'track-start' && pick?.track && manager.current) {
      const s = manager.current.snapshot;
      const generic = mcTrackPlan(s.event, pick.track, 'track-start');
      clip = saved.current?.clips.find(c => c.context === generic?.context);
    }
    return clip || null;
  };
  const command = (action: string, extra: any = {}) => {
    const show = manager.current;if (!show) return null;
    show.transition(action, current.current.position(), findClip, extra); publishShow();
    void checkpoint().catch(() => setMessage('Music continues. The latest resume position could not be saved.'));
    void sync().catch(() => {});
    return show.snapshot;
  };
  const patch = (data: any) => {if (!manager.current) return null; manager.current.patch(data);publishShow();void sync().catch(() => {});return manager.current.snapshot;};
  const saveClip = async (clip: any, signal?: AbortSignal) => {
    const manifest = saved.current;if (!manifest || savingClip.current.has(clip.id)) return;
    const voiceKey = current.current.snapshot?.mcVoiceKey || current.current.snapshot?.mcVoice || 'Zeus';
    if (manifest.voiceKey !== voiceKey) {manifest.clips = [];manifest.voiceKey = voiceKey;}
    if (manifest.clips.some(c => c.id === clip.id)) return;
    savingClip.current.add(clip.id);
    try {
      const source = `/api/mc-audio/${clip.id}`, response = await fetch(clip.url || clip.audioUrl || source, {signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)});
      if (!response.ok || response.status === 206 || response.headers.has('content-range')) return;
      const blob = await response.blob(), expected = Number(response.headers.get('content-length'));if (!blob.size || !blob.type.startsWith('audio/') || expected > 0 && blob.size !== expected) return;
      await store.current.put('audio', audioKey(manifest.key, source), blob);
      if (saved.current !== manifest) return;
      manifest.clips = [...manifest.clips.filter(c => c.context !== clip.context), {id: clip.id, context: clip.context, text: clip.text, source}];
      await store.current.put('shows', manifest.key, manifest);setPrepared({...manifest});
    } finally {savingClip.current.delete(clip.id);}
  };
  const prepare = async () => {
    if (!owner || !snapshot?.isOwner || download.current || manager.current) return;
    const abort = new AbortController(); download.current = abort;setPreparing(true);setMessage('');
    try {
      // The browser can deny persistence. Explicit readiness still verifies every
      // file, and Start performs the check again immediately before the show.
      setPersistent(await navigator.storage?.persist?.().catch(() => false) || false);
      const manifest = await downloadShow({store: store.current, owner, eventId, tracks: snapshot.tracks, signal: abort.signal, validate: validateDeviceAudio, progress: (done, total, label) => setProgress(`${done} / ${total} audio files saved · ${label}`)});
      saved.current = manifest;setPrepared(manifest);setHasDownload(true);
      if (snapshot.speechAvailable) {
        const plans: any[] = [...(snapshot.event.mc_enabled ? snapshot.tracks.flatMap((t: any) => [{kind: 'track-start', trackId: t.id}, {kind: 'track-end', trackId: t.id}]) : []), ...(snapshot.event.intro_enabled ? [{kind: 'intro'}] : []), ...(snapshot.event.outro_enabled ? [{kind: 'outro'}] : [])];
        for (let index = 0; index < plans.length; index++) {
          abort.signal.throwIfAborted();setProgress(`Audio saved · preparing MC recording ${index + 1} / ${plans.length}`);
          try {const clip = await request(`events/${eventId}/mc`, {method: 'POST', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(45000)]), body: JSON.stringify(plans[index])});if (clip.state === 'ready') await saveClip(clip, abort.signal);} catch (error) {if (abort.signal.aborted) throw error;}
        }
      }
      setMessage('Show saved. Start local playback while connected, then the downloaded music can continue without internet.');
    } catch (error: any) {
      saved.current = await store.current.get<SavedShow>('shows', showKey(owner, eventId)).catch(() => undefined) || null;setHasDownload(!!saved.current);
      setMessage(abort.signal.aborted ? 'Download stopped. Completed files are kept so you can continue later.' : error.name === 'QuotaExceededError' ? 'The device is out of storage. Free space and download again. Completed files can be reused.' : error.message || 'The show could not be saved. Retry the download.');
    } finally {download.current = null;setPreparing(false);setProgress('');}
  };
  const start = async () => {
    if (manager.current) return;
    const manifest = saved.current, s = current.current.snapshot;
    if (!manifest || !s?.isOwner || manifest.fingerprint !== showFingerprint(s.tracks) || !await verifySavedShow(store.current, manifest, showFingerprint(s.tracks))) {setPrepared(null);throw Error('The saved show is incomplete or has changed. Download it again before starting.');}
    // Missing optional MC recordings must never stall the downloaded music.
    const usable = [];
    for (const clip of manifest.clips) if ((await store.current.get<Blob>('audio', audioKey(manifest.key, clip.source)))?.size) usable.push(clip);
    manifest.clips = usable;await store.current.put('shows', manifest.key, manifest);
    const unlock = await lockLocalShow(eventId);release.current = unlock;
    const session = crypto.randomUUID(), position = current.current.position();
    // Save the claim ID first: a dropped HTTP response can then be recovered
    // without abandoning a permanent reservation on the server.
    const seed = new LocalShow(s, session);
    seed.setPosition(position);
    try {
      await store.current.put('checkpoints', manifest.key, seed.checkpoint(controller.current));
      const remote = await request(`events/${eventId}/control`, {method: 'POST', signal: AbortSignal.timeout(10000), body: JSON.stringify({action: 'local-start', controller: controller.current, localSession: session, position, playbackId: s.event.playback_id})});
      const show = new LocalShow(remote, session);manager.current = show;
      command('play');setMessage('Local playback started. Keep this tab open and the screen awake.');
    } catch (error) {unlock();release.current = null;throw error;}
  };
  const finish = async () => {
    const show = manager.current;if (!show) return;
    command('pause');
    // Wait for any old report, then send a fresh paused report. Releasing is
    // conditional on its exact sequence, so late packets cannot restart audio.
    await syncing.current?.catch(() => {});await sync();
    if (manager.current !== show) return;
    const remote = await request(`events/${eventId}/control`, {method: 'POST', signal: AbortSignal.timeout(8000), body: JSON.stringify({action: 'local-release', controller: controller.current, localSession: show.session, sequence: show.sequence})});
    manager.current = null;release.current?.();release.current = null;
    await store.current.remove('checkpoints', saved.current!.key);publish(remote);setMessage('Local playback ended. The downloaded audio is still saved on this device.');
  };
  const remove = async () => {if (manager.current || preparing || !saved.current) return;await removeSavedShow(store.current, saved.current);saved.current = null;setPrepared(null);setHasDownload(false);setMessage('Downloaded show removed from this device.');};
  const fetchAudio = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!manager.current) return fetch(input, init);
    return readLocalAudio(store.current, saved.current, String(input));
  };
  useEffect(() => {
    if (!owner || !eventId) return;
    let cancelled = false;
    void (async () => {
      const manifest = await store.current.get<SavedShow>('shows', showKey(owner, eventId));
      if (cancelled) return;
      saved.current = manifest || null;setHasDownload(!!manifest);
      setPrepared(manifest && await verifySavedShow(store.current, manifest, fingerprint) ? manifest : null);
      if (cancelled || manager.current || !manifest) return;
      const savedState = await store.current.get<LocalCheckpoint>('checkpoints', manifest.key);
      if (cancelled || !savedState || !current.current.snapshot.localSession || current.current.snapshot.localSession !== savedState.session) return;
      const unlock = await lockLocalShow(eventId);
      if (cancelled) {unlock();return;}
      release.current = unlock;controller.current = savedState.controller;
      try {sessionStorage.setItem('ym-controller', controller.current);} catch {}
      manager.current = LocalShow.restore(savedState);publishShow();
      setMessage('Saved show recovered and paused. Tap play to resume from its last saved audio position.');
      void sync().catch(() => {});
    })().catch((error: any) => setMessage(error.message || 'Local show storage is unavailable.'));
    return () => {cancelled = true;};
  }, [owner, eventId, fingerprint]);
  useEffect(() => {
    if (!manager.current) {release.current?.();release.current = null;return;}
    const timer = setInterval(() => {void sync().catch(() => {});}, 5000);
    const online = () => {void sync().catch(() => {});};
    const leave = (event: BeforeUnloadEvent) => {void checkpoint().catch(() => {});event.preventDefault();};
    window.addEventListener('online', online);window.addEventListener('beforeunload', leave);
    return () => {clearInterval(timer);window.removeEventListener('online', online);window.removeEventListener('beforeunload', leave);};
  }, [!!manager.current, sync]);
  useEffect(() => {if (prepared) for (const clip of mc.readyClips()) void saveClip(clip).catch(() => {});}, [mc.revision, prepared?.key]);
  useEffect(() => () => {download.current?.abort();release.current?.();}, []);
  return {prepared, hasDownload, preparing, progress, message, persistent, prepare, start, finish, remove, command, patch, fetchAudio, sync, cancel: () => download.current?.abort(), active: !!manager.current};
}
