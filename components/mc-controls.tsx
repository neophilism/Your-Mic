'use client';
import {useEffect, useRef, useState} from 'react';
import {Mic, LoaderCircle, Check} from 'lucide-react';
import {MC_TEXT_LIMIT, mcSpecialPlan, mcTrackPlan} from '../lib/mc';

export function McControls({snapshot, request, accept, mc, onEnd}: {snapshot: any; request: (path: string, options?: RequestInit) => Promise<any>; accept: (snapshot: any) => void; mc: any; onEnd: () => void}) {
  const event = snapshot.event, tracks = snapshot.tracks;
  const [selected, setSelected] = useState(''), [draft, setDraft] = useState(''), [custom, setCustom] = useState(false), [saveState, setSaveState] = useState(''), [draftSelection, setDraftSelection] = useState('');
  const latest = useRef(snapshot);latest.current = snapshot;
  const saveQueue = useRef<Promise<any>>(Promise.resolve());
  const editNumber = useRef(0), audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {if (!selected || selected !== 'intro' && selected !== 'outro' && !tracks.some((track: any) => 'start:'+track.id === selected || 'end:'+track.id === selected)) setSelected(event.current_track || tracks[0]?.id ? 'end:'+(event.current_track || tracks[0]?.id) : 'intro');}, [event.id, selected, event.current_track, tracks]);
  const selection = selected || (event.current_track || tracks[0]?.id ? 'end:'+(event.current_track || tracks[0]?.id) : 'intro');
  const special = selection === 'intro' || selection === 'outro';
  const part = selection.startsWith('start:') ? 'start' : 'end', trackId = special ? '' : selection.slice(selection.indexOf(':')+1);
  const track = tracks.find((t: any) => t.id === trackId);
  const stored = special ? event[selection + '_text'] || '' : track?.[part === 'start' ? 'mc_intro_text' : 'mc_text'] || '';
  useEffect(() => {setDraftSelection(selection);setDraft(stored);setCustom(!!stored);setSaveState('');editNumber.current++;}, [selection, event.id]);
  const saveSettings = async (values: any) => {
    try {accept(await request(`events/${event.id}/mc`, {method: 'PATCH', body: JSON.stringify(values)}));}
    catch (error: any) {setSaveState(error.message);}
  };
  useEffect(() => {
    const value = custom ? draft : '';
    if (draftSelection !== selection || value === stored) return;
    const number = ++editNumber.current;
    setSaveState('Saving…');
    const timer = setTimeout(async () => {
      try {
        const save = () => request(`events/${event.id}/mc`, {method: 'PATCH', body: JSON.stringify(special ? {[selection + 'Text']: value} : {trackId, part, text: value})});
        saveQueue.current = saveQueue.current.catch(() => {}).then(save);
        const result = await saveQueue.current;
        if (number !== editNumber.current) return;
        accept(result);setSaveState(result.speechAvailable ? 'Saved. Preparing voice…' : 'Saved');
        const prepared = await mc.prepare(special ? selection : part === 'start' ? 'track-start' : 'track-end', special ? undefined : trackId, true);
        if (number === editNumber.current) setSaveState(!result.speechAvailable ? 'Saved · Voice activates on Cloudflare' : prepared ? 'Saved · Recording ready' : 'Saved · Previous ready recording stays in place');
      } catch (error: any) {if (number === editNumber.current) setSaveState(error.message || 'Could not save. Try again.');}
    }, 650);
    return () => clearTimeout(timer);
  }, [draft, custom, draftSelection, selection, event.id, stored, request]);
  useEffect(() => () => {audio.current?.pause();}, []);
  const plan = special ? mcSpecialPlan(event, selection as 'intro' | 'outro') : mcTrackPlan(event, track, part === 'start' ? 'track-start' : 'track-end');
  const ready = mc.get(plan);
  const preview = () => {
    if (!ready) return;
    audio.current?.pause();audio.current = new Audio(ready.url);
    audio.current.play().catch(() => setSaveState('Tap preview again to allow audio.'));
  };
  const playing = snapshot.speakerHere && event.status === 'playing';
  useEffect(() => {if (playing) audio.current?.pause();}, [playing]);
  return <details className="mc-controls">
    <summary><span><Mic size={16}/> AI MC</span><span>{event.mc_enabled ? 'Track clips on' : 'Track clips off'}</span></summary>
    <p className="mc-description">Voice: {snapshot.mcVoice || 'Zeus'}{snapshot.mcExpressivity===2&&' · Maximum energy'}{!snapshot.milesReady && ' · Miles setup pending'}</p>
    <p className="mc-description">Each track has its own opening and closing clip. The next opening follows the actual playlist or queue selection; a closing credit never names the next song.</p>
    <div className="mc-checks">
      <label><input type="checkbox" checked={!!event.mc_enabled} onChange={e => saveSettings({enabled: e.target.checked})}/> Play track opening and closing clips</label>
      <label><input type="checkbox" checked={!!event.intro_enabled} onChange={e => saveSettings({introEnabled: e.target.checked})}/> Opening announcement when starting</label>
      <label><input type="checkbox" checked={!!event.outro_enabled} onChange={e => saveSettings({outroEnabled: e.target.checked})}/> Closing announcement when ending</label>
    </div>
    {!snapshot.speechAvailable && <p className="mc-description">Voice activates on the Cloudflare deployment. You can edit and save scripts here; this host has no speech connection.</p>}
    <label className="mc-label" htmlFor="mc-script">Edit announcement</label>
    <select id="mc-script" value={selection} onChange={e => setSelected(e.target.value)}>
      <option value="intro">Opening announcement (optional)</option>
      {tracks.map((track: any) => <optgroup label={track.title} key={track.id}><option value={"start:"+track.id}>Before: {track.title}</option><option value={"end:"+track.id}>After: {track.title}</option></optgroup>)}
      <option value="outro">Closing announcement (optional)</option>
    </select>
    <div className="mc-mode" role="group" aria-label="Announcement wording">
      <button type="button" className={!custom ? 'chosen' : ''} aria-pressed={!custom} onClick={() => setCustom(false)}>Automatic</button>
      <button type="button" className={custom ? 'chosen' : ''} aria-pressed={custom} onClick={() => setCustom(true)}>Custom text</button>
    </div>
    {custom ? <><label className="mc-label" htmlFor="mc-text">What should the MC say?</label><textarea id="mc-text" rows={4} maxLength={MC_TEXT_LIMIT} value={draft} placeholder={special ? 'Write your announcement…' : part === 'start' ? 'Write the words to introduce this song…' : 'Write the words to say after this song…'} onChange={e => setDraft(e.target.value)}/><small>{draft.length}/{MC_TEXT_LIMIT} · Saves automatically. {special ? 'Use {artist}, {album}, or {event}.' : 'Use {track}, {album}, or {artist}.'}</small></> : <p className="mc-auto-copy">{special ? mcSpecialPlan({...event, [selection + '_text']: ''}, selection as 'intro' | 'outro').text : part === 'start' ? 'The MC introduces this track, album, and artist. A queued rapper’s name is added when their recording is ready.' : 'The MC credits this track, album, and artist. It does not name the next song.'}</p>}
    {!special && <small>{part === 'start' ? 'A queued rapper’s callout is appended automatically when ready.' : 'Keep this closing clip about this song. The following track carries its own introduction.'}</small>}
    <div className="mc-status" role="status">{saveState === 'Saving…' ? <LoaderCircle size={13} className="spin"/> : <Check size={13}/>} {saveState || mc.status || 'Ready for your set'}</div>
    {ready && <div className="mc-ready"><p>{ready.text}</p><button type="button" className="text-button" disabled={playing} onClick={preview}>Preview voice on this device</button>{playing && <small>Pause the speaker to preview without interrupting the music.</small>}</div>}
    <div className="mc-ending">
      <label><input type="checkbox" checked={!!event.end_after_track} disabled={!!event.show_ended || !event.current_track} onChange={e => saveSettings({endAfterTrack: e.target.checked})}/> End show after this song</label>
      <small>{event.end_after_track ? `The set will stop after this song${event.outro_enabled ? ', with your closing announcement' : ''}. The remaining playlist will not play.` : 'End wherever you are in the set. The closing announcement is optional.'}</small>
      {!event.current_track && !event.show_ended && <button type="button" className="button secondary small" disabled={!snapshot.speakerHere} onClick={onEnd}>End show now</button>}
      {!!event.show_ended && <p>Show ended. Press play to start again.</p>}
    </div>
  </details>;
}
