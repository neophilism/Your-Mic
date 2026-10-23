import { sqliteTable, text, integer, real, uniqueIndex, index, primaryKey } from 'drizzle-orm/sqlite-core';
export const events = sqliteTable('events', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull(), title: text('title').notNull(),
  artist: text('artist').notNull(), recordLabel: text('record_label').notNull().default(''), playbackId: text('playback_id').notNull().default(''), album: text('album').notNull().default(''), location: text('location').notNull().default(''),
  queueOpen: integer('queue_open').notNull().default(1), createdAt: integer('created_at').notNull(),
  mode: text('mode').notNull().default('album'), pendingMode: text('pending_mode'), micAfterTrack: text('mic_after_track'),
  status: text('status').notNull().default('idle'), currentTrack: text('current_track'), currentEntry: text('current_entry'),
  albumCursor: text('album_cursor'), startedAt: integer('started_at'), position: real('position').notNull().default(0),
  mcEnabled: integer('mc_enabled').notNull().default(1), announcementId: text('announcement_id'), announcementKind: text('announcement_kind'),
  introPlayed: integer('intro_played').notNull().default(0),
  introEnabled: integer('intro_enabled').notNull().default(0), introText: text('intro_text').notNull().default(''),
  outroEnabled: integer('outro_enabled').notNull().default(0), outroText: text('outro_text').notNull().default(''),
  endAfterTrack: integer('end_after_track').notNull().default(0), showEnded: integer('show_ended').notNull().default(0),
  version: integer('version').notNull().default(0), controllerHash: text('controller_hash'), controllerUntil: integer('controller_until'),
  localSessionId: text('local_session_id').notNull().default(''), localSequence: integer('local_sequence').notNull().default(0),
}, t=>[index('events_owner').on(t.ownerId)]);
export const tracks = sqliteTable('tracks', {
  id: text('id').primaryKey(), eventId: text('event_id').notNull().references(()=>events.id), title: text('title').notNull(),
  mcText: text('mc_text').notNull().default(''),
  mcIntroText: text('mc_intro_text').notNull().default(''),
  position: integer('position').notNull(), duration: real('duration').notNull().default(0), beatDuration: real('beat_duration'),
  audioKey: text('audio_key').notNull(), beatKey: text('beat_key'), mime: text('mime').notNull(), beatMime: text('beat_mime'),
},t=>[index('tracks_event').on(t.eventId,t.position)]);
export const entries = sqliteTable('entries', {
  id: text('id').primaryKey(), eventId: text('event_id').notNull().references(()=>events.id), trackId: text('track_id').notNull().references(()=>tracks.id),
  name: text('name').notNull(), guestHash: text('guest_hash').notNull(), status: text('status').notNull().default('waiting'),
  createdAt: integer('created_at').notNull(),
},t=>[index('entries_event').on(t.eventId,t.status,t.createdAt)]);
export const subscribers = sqliteTable('subscribers', {
  id: text('id').primaryKey(), eventId: text('event_id').notNull().references(()=>events.id), email: text('email').notNull(),
  createdAt: integer('created_at').notNull(), consent: text('consent').notNull(),
},t=>[uniqueIndex('subscriber_unique').on(t.eventId,t.email)]);

export const mcClips = sqliteTable('mc_clips', {
  id: text('id').primaryKey(), eventId: text('event_id').notNull().references(()=>events.id),
  context: text('context').notNull(), text: text('text').notNull(), state: text('state').notNull(), audioKey: text('audio_key'),
  lease: text('lease').notNull(), leaseUntil: integer('lease_until').notNull().default(0), createdAt: integer('created_at').notNull(),
},t=>[index('mc_clips_event').on(t.eventId,t.createdAt)]);

export const trackPlays = sqliteTable('track_plays', {
  eventId: text('event_id').notNull().references(()=>events.id, {onDelete: 'cascade'}),
  playbackId: text('playback_id').notNull(),
  trackId: text('track_id').notNull().references(()=>tracks.id, {onDelete: 'cascade'}),
  kind: text('kind').notNull(), playedAt: integer('played_at').notNull(),
},t=>[primaryKey({columns:[t.eventId,t.playbackId]}), index('track_plays_event_track').on(t.eventId,t.trackId)]);
