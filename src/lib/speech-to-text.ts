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
      options.onError("Microphone permission denied. Allow mic access in the browser.");
    } else {
      options.onError(`Speech recognition failed (${code}). Try again or type your message.`);
    }
    options.onEnd();
  };

  recognition.onend = () => options.onEnd();
  return recognition;
}
