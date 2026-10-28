"use client";

import { useEffect, useRef, useState } from "react";

// Minimal typing of the Web Speech API (Chrome, Edge, iOS/macOS Safari). Not in
// every TS DOM lib, so declared here. Firefox has no implementation: the button
// simply does not render there.
interface SRResultAlt { transcript: string }
interface SRResult { isFinal: boolean; 0: SRResultAlt; length: number }
interface SREvent { resultIndex: number; results: { length: number; [i: number]: SRResult } }
interface SRErrorEvent { error: string }
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SREvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SRCtor = new () => SpeechRecognitionLike;

function getCtor(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Push-to-talk mic. Calls onText with the running transcript (interim results
 * included) so the textarea fills while the user speaks; final = true on the
 * last call of a session. Renders nothing when the browser has no speech API.
 */
export default function VoiceButton({
  onText,
  onStart,
  lang = "zh-CN",
}: {
  onText: (text: string, final: boolean) => void;
  onStart?: () => void;
  lang?: string;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    // Feature detection must run on the client; the server renders nothing.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(getCtor() != null);
    return () => recRef.current?.abort();
  }, []);

  function start() {
    const Ctor = getCtor();
    if (!Ctor) return;
    setError(null);
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let finalText = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      onText((finalText + interim).trim(), false);
    };
    rec.onerror = (e) => {
      // "no-speech" and "aborted" are normal ends; the rest are worth a hint.
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setError("浏览器没有给麦克风权限");
      else if (e.error === "network") setError("语音识别需要联网");
      else if (e.error !== "no-speech" && e.error !== "aborted") setError("识别失败,再试一次或直接打字");
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
      if (finalText.trim()) onText(finalText.trim(), true);
    };
    recRef.current = rec;
    onStart?.();
    setListening(true);
    rec.start();
  }

  function stop() {
    recRef.current?.stop();
  }

  if (!supported) return null;

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={listening ? stop : start}
        aria-pressed={listening}
        aria-label={listening ? "停止录音" : "按一下开始说话"}
        data-testid="voice-button"
        className={`relative flex h-12 w-12 items-center justify-center rounded-full transition ${
          listening ? "bg-red-500 text-white shadow-lg" : "bg-zinc-900 text-white"
        }`}
      >
        {listening && <span className="absolute inset-0 animate-ping rounded-full bg-red-400 opacity-60" />}
        <svg viewBox="0 0 24 24" className="relative h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" />
        </svg>
      </button>
      {error && <p className="mt-1 text-center text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
