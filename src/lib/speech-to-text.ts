/** Browser speech-to-text helpers for the website chat mic (edit-then-send). */

export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionResultEventLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function speechRecognitionSupported(): boolean {
  return Boolean(getSpeechRecognitionCtor());
}

export function speechLangFromUi(lang?: string): string {
  const code = (lang || "").toUpperCase();
  if (code === "HI") return "hi-IN";
  if (code === "TA") return "ta-IN";
  return "en-IN";
}

/**
 * Ask the browser for mic access first so the native Allow/Deny prompt appears
 * (especially important when the chat runs inside an iframe).
 */
export async function ensureMicrophonePermission(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone is not available in this browser.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of stream.getTracks()) track.stop();
}

export function createSpeechRecognition(options: {
  lang?: string;
  onInterim?: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}): SpeechRecognitionLike | null {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return null;

  const recognition = new Ctor();
  recognition.lang = speechLangFromUi(options.lang);
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    let interim = "";
    let finalText = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const piece = event.results[i]?.[0]?.transcript || "";
      if (event.results[i]?.isFinal) finalText += piece;
      else interim += piece;
    }
    if (interim.trim()) options.onInterim?.(interim.trim());
    if (finalText.trim()) options.onFinal(finalText.trim());
  };

  recognition.onerror = (event) => {
    const code = event.error || "unknown";
    if (code === "aborted" || code === "no-speech") {
      options.onEnd();
      return;
    }
    if (code === "not-allowed") {
      options.onError(
        "Microphone blocked. Click the lock/mic icon in the browser address bar and choose Allow, then try again.",
      );
    } else {
      options.onError(`Speech recognition failed (${code}). Try again or type your message.`);
    }
    options.onEnd();
  };

  recognition.onend = () => options.onEnd();
  return recognition;
}
