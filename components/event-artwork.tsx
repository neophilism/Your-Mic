import type {ReactNode} from 'react';

const covers: Record<string, {src: string; alt: string}> = {
  '2419c7ab-6369-4ebb-a316-304dfaa61766': {
    src: '/covers/minnesota-ave.webp',
    alt: 'Minnesota Ave. album cover by Capture Shock',
  },
};

export function EventArtwork({eventId, className, children, priority = false}: {eventId: string; className: string; children: ReactNode; priority?: boolean}) {
  const cover = covers[eventId];
  return <div className={className + (cover ? ' has-cover' : '')}>
    {cover ? <img className="event-cover-image" src={cover.src} alt={cover.alt} width="960" height="960" loading={priority ? 'eager' : 'lazy'} decoding="async"/> : children}
  </div>;
}
