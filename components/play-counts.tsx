'use client';
import {useCallback, useEffect, useState} from 'react';
import {ChevronDown, ChevronUp, RotateCcw} from 'lucide-react';
type Counts = {tracks: Array<{id: string; title: string; livePlays: number; rapPlays: number; privatePlays: number}>; totalLivePlays: number; totalRapPlays: number; totalPrivatePlays: number};
export function PlayCounts({eventId, request}: {eventId: string; request: (path: string, options?: RequestInit) => Promise<any>}) {
  const [open, setOpen] = useState(false), [counts, setCounts] = useState<Counts | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true);setError('');
    try {setCounts(await request(`events/${eventId}/plays`, {signal: AbortSignal.timeout(10000)}));}
    catch {setError('Counts could not load. Try Refresh counts when connected.');}
    finally {setLoading(false);}
  }, [eventId, request]);
  useEffect(() => {if (open) void refresh();}, [open, refresh]);
  return <section className="play-counts" aria-label="Artist play counts">
    <div className="play-counts-head"><button className="text-button" aria-expanded={open} aria-controls="play-counts-results" onClick={() => setOpen(v => !v)}>{open ? <ChevronUp size={16}/> : <ChevronDown size={16}/>} Play counts <span className="eyebrow">ARTIST ONLY</span></button>{open && <button className="text-button" disabled={loading} onClick={() => void refresh()}><RotateCcw size={14}/>{loading ? 'Loading counts…' : 'Refresh counts'}</button>}</div>
    {open && <div id="play-counts-results">
      <p>Private listens count headphone previews. Live plays count speaker starts; Rap turns are the freestyle performances included in that live total. Pause/resume does not add plays. Tracking starts with this update.</p>
      {error && <p role="status">{error}</p>}
      {counts && <><div className="play-counts-table"><table><thead><tr><th scope="col">Song</th><th scope="col">Private listens</th><th scope="col">Live plays</th><th scope="col">Rap turns</th></tr></thead><tbody>{counts.tracks.map(t => <tr key={t.id}><td>{t.title}</td><td>{t.privatePlays}</td><td>{t.livePlays}</td><td>{t.rapPlays}</td></tr>)}</tbody><tfoot><tr><th scope="row">Total</th><td>{counts.totalPrivatePlays}</td><td>{counts.totalLivePlays}</td><td>{counts.totalRapPlays}</td></tr></tfoot></table></div>{!counts.tracks.length && <p>Upload a song to begin.</p>}</>}
    </div>}
  </section>;
}
