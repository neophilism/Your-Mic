export const MC_MODEL = '@cf/deepgram/aura-2-en';
export const MC_VOICE = 'zeus';
export const MC_MILES_MODEL = 'flux-miles-en';
export const MC_TEXT_LIMIT = 600;

export type McPlan = {context: string; text: string; kind: 'between' | 'intro' | 'outro'; nextTrackId: string | null; nextEntryId: string | null};

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
