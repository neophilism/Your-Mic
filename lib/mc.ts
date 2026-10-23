import {MILES_MODEL} from './miles.mjs';
export const MC_MODEL = '@cf/deepgram/aura-2-en';
export const MC_VOICE = 'zeus';
export const MC_MILES_MODEL = MILES_MODEL;
export const MC_TEXT_LIMIT = 600;

export type McKind = 'between' | 'intro' | 'outro' | 'track-start' | 'track-end';
export type McPlan = {context: string; text: string; kind: McKind; nextTrackId: string | null; nextEntryId: string | null};

// A track's closing credit never names its successor. Its opening recording is
// independent of the preceding song, so queue changes cannot create a false cue.
export function mcTrackPlan(event: any, track: any, kind: 'track-start' | 'track-end', entry: any = null): McPlan | null {
  if (!track || event.mc_enabled === 0) return null;
  const variant = Math.abs(Number(track.position) || 0) % 3;
  const credit = `${track.title}${event.album ? ` on ${event.album}` : ''} by ${event.artist}`;
  const defaults = kind === 'track-end' ? [`That was ${credit}.`, `You just heard ${credit}.`, `That’s ${credit}.`] : [`Up next, ${credit}.`, `Coming up, ${credit}.`, `Next on the set, ${credit}.`];
  const values: Record<string, string> = {track: track.title, album: event.album || '', artist: event.artist};
  const custom = String(track[kind === 'track-start' ? 'mc_intro_text' : 'mc_text'] || '').replace(/\{(track|album|artist)\}/g, (_all, key) => values[key]).trim();
  const rapper = kind === 'track-start' ? entry : null;
  return {context: JSON.stringify([event.id, kind, track.id, track.title, rapper?.id || null, rapper?.name || null]),
    text: `${custom || defaults[variant]}${rapper ? ` ${rapper.name}, it’s your mic!` : ''}`, kind,
    nextTrackId: kind === 'track-start' ? track.id : null, nextEntryId: rapper?.id || null};
}

export function mcSpecialPlan(event: any, kind: 'intro' | 'outro'): McPlan {
  const values: Record<string, string> = {artist: event.artist, album: event.album || event.title, event: event.title};
  const fallback = kind === 'intro'
    ? `Welcome to ${event.title}! This is ${event.artist}${event.album ? `, bringing you ${event.album}` : ''}. Find your beat, join the mic line, and let’s get into it!`
    : `That’s the set! Big love to everyone who took the mic. This is ${event.artist}. Scan the code and join the album release list. Thanks for coming through!`;
  const script = String(event[kind + '_text'] || '').replace(/\{(artist|album|event)\}/g, (_all, key) => values[key]).trim();
  return {context: JSON.stringify([event.id, kind]), text: script || fallback, kind, nextTrackId: null, nextEntryId: null};
}

// The context excludes the script: a late edit may use the previous recording,
// but a changed performer, track, or playback mode must never use a stale callout.
export function mcPlan(event: any, tracks: any[], pick: any): McPlan | null {
  if (event.end_after_track) return event.outro_enabled ? mcSpecialPlan(event, 'outro') : null;
  const previous = tracks.find(t => t.id === event.current_track);
  if (!previous || !pick.track || event.mc_enabled === 0) return null;
  const variant = Math.abs(Number(event.version) || 0) % 3;
  const credit = `${previous.title}${event.album ? ` on ${event.album}` : ''} by ${event.artist}`;
  const defaults = [`That was ${credit}.`, `You just heard ${credit}.`, `That’s ${credit}.`];
  const values: Record<string, string> = {track: previous.title, album: event.album || '', artist: event.artist};
  const custom = String(previous.mc_text || '').replace(/\{(track|album|artist)\}/g, (_all, key) => values[key]);
  const cue = pick.entry
    ? `Playing next, ${pick.track.title}. ${pick.entry.name}, it’s your mic!`
    : [`Up next, ${pick.track.title}.`, `Coming up, ${pick.track.title}.`, `Next on the set, ${pick.track.title}.`][variant];
  return {
    context: JSON.stringify([event.id, previous.id, event.current_entry || null, pick.mode, pick.track.id, pick.track.title, pick.entry?.id || null, pick.entry?.name || null]),
    text: `${custom.trim() || defaults[variant]} ${cue}`,
    kind: 'between',
    nextTrackId: pick.track.id,
    nextEntryId: pick.entry?.id || null,
  };
}

export function mcPreparationKey(event: any, tracks: any[], pick: any) {
  const plan = mcPlan(event, tracks, pick);
  return plan ? JSON.stringify([plan.context, plan.text]) : '';
}

export function canUseMcClip(clip: {context: string} | null, plan: McPlan | null) {
  return !!clip && !!plan && clip.context === plan.context;
}
