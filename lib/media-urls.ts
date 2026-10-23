// A playing OR paused decoder may still need its source to resume. Release only
// URLs no longer referenced by any media element, including during voice edits.
export function releaseUnusedMediaUrls(urls: Set<string>, media: Iterable<{src: string; currentSrc?: string}>, revoke: (url: string) => void) {
  const inUse = new Set<string>();
  for (const element of media) {inUse.add(element.src);if (element.currentSrc) inUse.add(element.currentSrc);}
  for (const url of urls) if (!inUse.has(url)) {revoke(url);urls.delete(url);}
}
