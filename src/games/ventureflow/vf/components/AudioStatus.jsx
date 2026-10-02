import { useCallback, useEffect, useState } from 'react';
import { audioDiagnostics, unlockAudio, subscribeAudioSettings } from '../audio/soundEngine';
import { unlockMusic } from '../audio/musicEngine';

const POLL_MS = 1500;

/**
 * "Why can't I hear anything?" — answered in the game rather than guessed at.
 *
 * A player who hears nothing has no way to tell the three causes apart, and
 * they need completely different fixes:
 *
 *   - the sound is MUTED (theirs, or a previous session's — it persists in
 *     localStorage, so it survives every reload and every new build);
 *   - the browser is BLOCKING audio (no gesture yet, an embedded preview
 *     pane, an iframe without `allow="autoplay"`, a muted tab);
 *   - the browser has no Web Audio at all.
 *
 * From inside the page all three look identical: the code runs, notes get
 * scheduled, silence comes out. So this shows a single, honest button naming
 * the actual cause — and clicking it IS the fix, because the click is a real
 * user gesture, which is the one thing a browser requires before it will
 * grant audio.
 *
 * When sound is working it renders nothing at all.
 *
 * Polled rather than event-driven because a context can be resumed or
 * suspended by the browser itself (tab backgrounded, OS mute) with no
 * callback of any kind.
 */
export default function AudioStatus() {
  const [diag, setDiag] = useState(() => audioDiagnostics());
  const [detail, setDetail] = useState(null);

  const refresh = useCallback(() => setDiag(audioDiagnostics()), []);

  useEffect(() => {
    const unsubscribe = subscribeAudioSettings(refresh);
    const id = setInterval(refresh, POLL_MS);
    return () => {
      unsubscribe();
      clearInterval(id);
    };
  }, [refresh]);

  async function handleClick() {
    // Both engines, from this one gesture — they hold separate AudioContexts
    // and a browser grants them separately.
    const [sound, music] = await Promise.all([unlockAudio(), unlockMusic()]);
    setDiag(sound);
    if (sound.reason !== 'ok') {
      // Still blocked. Say so precisely rather than leaving them clicking a
      // button that appears to do nothing.
      setDetail(
        `Sound is still blocked (audio: ${sound.contextState}, music: ${music.contextState}). ` +
          'If the game is running inside a preview pane, open it in its own browser tab — ' +
          'embedded frames are not allowed to play audio.'
      );
    } else {
      setDetail(null);
    }
  }

  if (diag.reason === 'ok') return null;

  const label =
    diag.reason === 'muted'
      ? '🔇 Sound is off — turn it on'
      : diag.reason === 'unsupported'
      ? '🔇 This browser has no sound support'
      : '🔇 Enable sound';

  return (
    <div className="vf-audio-status">
      <button
        type="button"
        className="vf-btn vf-btn--sm vf-btn--warm vf-audio-status__btn"
        onClick={handleClick}
        disabled={diag.reason === 'unsupported'}
        title={
          diag.reason === 'muted'
            ? 'Sound is muted. Click to turn it back on.'
            : 'Your browser has not allowed sound yet. Click to enable it.'
        }
      >
        {label}
      </button>
      {detail && <p className="vf-audio-status__detail">{detail}</p>}
    </div>
  );
}
