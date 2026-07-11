// Web Speech API wrapper for the resident voice-complaint sub-flow (UC-001).
// Transcription only — the transcript fills the Description field in whatever
// language was spoken. No audio upload/storage and no translation here.

// Chrome/Edge expose the prefixed constructor; Safari uses the standard name.
const SpeechRecognitionImpl =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : undefined;

// Languages relevant to Singapore residents. The recognition language decides
// what the engine transcribes — dictate in Malay, get Malay text, etc.
export const VOICE_LANGUAGES = [
  { code: 'en-SG', label: 'English (SG)' },
  { code: 'en-US', label: 'English (US)' },
  { code: 'zh-CN', label: '中文 (Mandarin)' },
  { code: 'ms-MY', label: 'Bahasa Melayu' },
  { code: 'ta-IN', label: 'தமிழ் (Tamil)' },
];

export function isSpeechSupported() {
  return Boolean(SpeechRecognitionImpl);
}

// Start listening. Returns the recognition instance (call .stop() to end), or
// null when unsupported. Callbacks:
//   onResult(finalChunk, interim) — finalChunk is newly finalised text ('' if
//     none this event); interim is the current in-progress guess.
//   onEnd() — fired when recognition stops for any reason (tap-stop, silence,
//     permission denied), so the UI can reset its recording state.
export function startRecognition({ lang, onResult, onEnd }) {
  if (!SpeechRecognitionImpl) return null;

  const recognition = new SpeechRecognitionImpl();
  recognition.lang = lang;
  recognition.continuous = true; // keep listening until stopped
  recognition.interimResults = true; // stream partial guesses for live feedback

  recognition.onresult = (event) => {
    let finalChunk = '';
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const text = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalChunk += text;
      else interim += text;
    }
    onResult(finalChunk, interim);
  };
  // Errors (mic denied, no speech, network) all just end the session — the
  // form must keep working, so there's no blocking error state.
  recognition.onerror = () => {};
  recognition.onend = () => onEnd();

  recognition.start();
  return recognition;
}
