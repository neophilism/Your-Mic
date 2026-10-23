export const MILES_MODEL = 'flux-miles-en';
// Deepgram's full animated range ends at +2. This changes delivery, not volume.
export const MILES_EXPRESSIVITY = 2;
export const MILES_VOICE_KEY = `${MILES_MODEL}:expressivity=${MILES_EXPRESSIVITY}`;
export function milesSpeechUrl() {
  return `https://api.deepgram.com/v2/speak?model=${MILES_MODEL}&encoding=mp3&expressivity=${MILES_EXPRESSIVITY}`;
}
