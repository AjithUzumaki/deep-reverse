"use client";

import { useCallback, useEffect, useRef, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api";
import { streamChat, type ChatAttachmentPayload } from "@/lib/chat-stream";
import SitePreview from "./site-preview";
import {
  applyWorkspaceFile,
  localAgentFetch,
  LOCAL_AGENT_TOKEN_KEY,
  LOCAL_WORKSPACE_CHAT_DRAFT_KEY,
  LOCAL_WORKSPACE_COMMAND_KEY,
  type LocalWorkspaceConnection,
} from "@/lib/local-workspace-client";
import { WORKSPACE_BUILD_INSTRUCTIONS, WORKSPACE_CONTEXT_MARKER } from "@/lib/workspace-agent";
import { extractWebsiteArtifact, isWebsiteFollowUp, isWebsiteRequest, WEBSITE_BUILD_INSTRUCTIONS } from "@/lib/website-preview";

interface ConversationSummary {
  id: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  updated_at: string;
}

interface MessageBlock {
  type: string;
  text?: string;
  name?: string;
  mime_type?: string;
}

interface PendingChatAttachment {
  id: string;
  file: File;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: MessageBlock[];
  created_at?: string;
}

interface CodeRunOutput {
  language: string;
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
  success: boolean;
  error?: string;
  images?: string[];
}

interface GeneratedImage {
  id: string;
  prompt: string;
  image_url: string;
  style: string;
  aspect_ratio: string;
}

interface VoiceLanguage {
  id: string;
  label: string;
  speechTag: string;
  responseLanguage: string;
}

interface VoiceSendContext {
  languageId: string;
  audio?: {
    base64: string;
    mimeType: string;
  };
}

type VoiceCharacter = "auto" | "female" | "male";
type VoiceTone = "natural" | "calm" | "friendly" | "energetic" | "professional";

const VOICE_TONE_SETTINGS: Record<VoiceTone, { rate: number; pitch: number }> = {
  natural: { rate: 1, pitch: 0 },
  calm: { rate: 0.88, pitch: -0.04 },
  friendly: { rate: 1, pitch: 0.08 },
  energetic: { rate: 1.14, pitch: 0.14 },
  professional: { rate: 0.96, pitch: -0.04 },
};

const VOICE_CHARACTER_HINTS: Record<Exclude<VoiceCharacter, "auto">, RegExp> = {
  female: /\b(female|woman|zira|samantha|susan|karen|aria|jenny|heera|veena|hazel|sara|eva|katja|helena|monica|libby)\b/i,
  male: /\b(male|man|david|mark|guy|james|daniel|alex|thomas|oliver|george|ravi|prabhat|fred)\b/i,
};

const VOICE_LANGUAGES: VoiceLanguage[] = [
  { id: "auto", label: "Auto detect · any supported language", speechTag: "", responseLanguage: "the language used in the user's message" },
  { id: "en-IN", label: "English (India)", speechTag: "en-IN", responseLanguage: "English" },
  { id: "en-US", label: "English (US)", speechTag: "en-US", responseLanguage: "English" },
  { id: "ta-IN", label: "Tamil · தமிழ்", speechTag: "ta-IN", responseLanguage: "Tamil" },
  { id: "tanglish", label: "Tanglish", speechTag: "en-IN", responseLanguage: "Tanglish, conversational Tamil-English written in Latin letters" },
  { id: "hi-IN", label: "Hindi · हिन्दी", speechTag: "hi-IN", responseLanguage: "Hindi" },
  { id: "de-DE", label: "German · Deutsch", speechTag: "de-DE", responseLanguage: "German" },
  { id: "fr-FR", label: "French · Français", speechTag: "fr-FR", responseLanguage: "French" },
  { id: "es-ES", label: "Spanish · Español", speechTag: "es-ES", responseLanguage: "Spanish" },
  { id: "pt-BR", label: "Portuguese · Português", speechTag: "pt-BR", responseLanguage: "Portuguese" },
  { id: "te-IN", label: "Telugu · తెలుగు", speechTag: "te-IN", responseLanguage: "Telugu" },
  { id: "ml-IN", label: "Malayalam · മലയാളം", speechTag: "ml-IN", responseLanguage: "Malayalam" },
  { id: "ja-JP", label: "Japanese · 日本語", speechTag: "ja-JP", responseLanguage: "Japanese" },
];

function blockText(content: MessageBlock[]): string {
  return content.map((b) => b.text ?? "").join("");
}

const MAX_CHAT_ATTACHMENTS = 5;
const MAX_CHAT_ATTACHMENT_BYTES = 8 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", heic: "image/heic", heif: "image/heif",
  pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json", jsonl: "application/x-ndjson",
  xml: "application/xml", html: "text/html", css: "text/css", js: "text/javascript", ts: "text/plain", tsx: "text/plain", py: "text/x-python", log: "text/plain",
};

function attachmentMimeType(file: File): string {
  if (file.type && file.type !== "application/octet-stream") return file.type;
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

function encodeChatAttachment(file: File): Promise<ChatAttachmentPayload> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const comma = dataUrl.indexOf(",");
      if (comma < 0) {
        reject(new Error(`Could not prepare ${file.name} for upload.`));
        return;
      }
      resolve({ name: file.name, mime_type: attachmentMimeType(file), data_base64: dataUrl.slice(comma + 1) });
    };
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function inferSpeechLocale(text: string): string {
  if (/[\u0B80-\u0BFF]/.test(text)) return "ta-IN";
  if (/[\u0900-\u097F]/.test(text)) return "hi-IN";
  if (/[\u0980-\u09FF]/.test(text)) return "bn-IN";
  if (/[\u0A00-\u0A7F]/.test(text)) return "pa-IN";
  if (/[\u0A80-\u0AFF]/.test(text)) return "gu-IN";
  if (/[\u0B00-\u0B7F]/.test(text)) return "or-IN";
  if (/[\u0C00-\u0C7F]/.test(text)) return "te-IN";
  if (/[\u0C80-\u0CFF]/.test(text)) return "kn-IN";
  if (/[\u0D00-\u0D7F]/.test(text)) return "ml-IN";
  if (/[\uAC00-\uD7AF]/.test(text)) return "ko-KR";
  if (/[\u3040-\u30FF]/.test(text)) return "ja-JP";
  if (/[\u4E00-\u9FFF]/.test(text)) return "zh-CN";
  if (/[\u0600-\u06FF]/.test(text)) return "ar-SA";
  if (/[\u0590-\u05FF]/.test(text)) return "he-IL";
  if (/[\u0E00-\u0E7F]/.test(text)) return "th-TH";
  if (/[\u0E80-\u0EFF]/.test(text)) return "lo-LA";
  if (/[\u0F00-\u0FFF]/.test(text)) return "bo-CN";
  if (/[\u1000-\u109F]/.test(text)) return "my-MM";
  if (/[\u10A0-\u10FF]/.test(text)) return "ka-GE";
  if (/[\u1200-\u137F]/.test(text)) return "am-ET";
  if (/[\u1780-\u17FF]/.test(text)) return "km-KH";
  if (/[\u0530-\u058F]/.test(text)) return "hy-AM";
  if (/[\u0D80-\u0DFF]/.test(text)) return "si-LK";
  if (/[\u0370-\u03FF]/.test(text)) return "el-GR";
  const words = new Set((text.toLocaleLowerCase().match(/[a-z\u00C0-\u024F\u1E00-\u1EFF\u0370-\u08FF\u0900-\u0DFF\u0E00-\u10FF\u1200-\u137F\u1780-\u17FF\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]+/g) ?? []));
  const languageClues: Array<{ locale: string; words: string[] }> = [
    { locale: "fr-FR", words: ["bonjour", "merci", "avec", "vous", "nous", "suis", "pour", "comment", "parce", "très", "une", "est", "pas", "votre"] },
    { locale: "de-DE", words: ["hallo", "danke", "bitte", "und", "ich", "nicht", "ist", "wir", "mit", "für", "das", "der", "eine"] },
    { locale: "es-ES", words: ["hola", "gracias", "quiero", "necesito", "puedes", "está", "cómo", "para", "pero", "porque", "buenos", "buenas"] },
    { locale: "pt-BR", words: ["olá", "obrigado", "obrigada", "você", "não", "preciso", "quero", "está", "uma", "com"] },
    { locale: "it-IT", words: ["ciao", "grazie", "prego", "buongiorno", "perché", "sono", "questo", "questa", "con", "come"] },
    { locale: "ru-RU", words: ["привет", "спасибо", "пожалуйста", "что", "это", "как", "для", "можно", "нужно"] },
    { locale: "nl-NL", words: ["hallo", "bedankt", "alsjeblieft", "waarom", "met", "niet", "een", "voor", "goed"] },
    { locale: "id-ID", words: ["halo", "terima", "kasih", "tolong", "saya", "kamu", "yang", "untuk", "tidak"] },
    { locale: "vi-VN", words: ["xin", "chào", "cảm", "ơn", "không", "được", "tôi", "bạn", "với", "một"] },
    { locale: "uk-UA", words: ["привіт", "дякую", "будь", "ласка", "що", "як", "так", "це", "можна"] },
    { locale: "bg-BG", words: ["здравей", "благодаря", "моля", "добре", "как", "това", "защо"] },
    { locale: "pl-PL", words: ["cześć", "dziękuję", "proszę", "dlaczego", "jest", "się", "nie", "możesz"] },
    { locale: "tr-TR", words: ["merhaba", "teşekkür", "lütfen", "nasıl", "için", "ben", "bir", "değil"] },
    { locale: "ro-RO", words: ["salut", "mulțumesc", "te rog", "pentru", "este", "sunt", "care"] },
    { locale: "sv-SE", words: ["hej", "tack", "snälla", "varför", "och", "inte", "det", "jag"] },
    { locale: "da-DK", words: ["hej", "tak", "venligst", "hvorfor", "og", "ikke", "det", "jeg"] },
    { locale: "nb-NO", words: ["hei", "takk", "vennligst", "hvorfor", "og", "ikke", "det", "jeg"] },
    { locale: "fa-IR", words: ["سلام", "ممنون", "لطفا", "برای", "این", "است", "چطور"] },
    { locale: "ur-PK", words: ["سلام", "شکریہ", "براہ", "مہربانی", "کیا", "ہے", "کیسے"] },
    { locale: "ms-MY", words: ["hai", "terima", "kasih", "sila", "mengapa", "untuk", "adalah"] },
    { locale: "en-IN", words: ["enna", "epdi", "illai", "irukku", "seri", "venum", "sollu", "panren", "pannunga", "saptiya", "sapten", "romba", "ippo"] },
  ];
  const detected = languageClues
    .map(({ locale, words: clues }) => ({ locale, score: clues.reduce((score, clue) => score + Number(words.has(clue)), 0) }))
    .sort((a, b) => b.score - a.score)[0];
  if (detected?.score) return detected.locale;
  return typeof navigator !== "undefined" && navigator.language ? navigator.language : "en-IN";
}

export default function ChatPage() {
  const { user, accessToken, loading, logout } = useAuth();
  const router = useRouter();

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [previewOverride, setPreviewOverride] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"chat" | "preview">("chat");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [workspaceConnection, setWorkspaceConnection] = useState<LocalWorkspaceConnection>({ connected: false, token: null, workspace: null });
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<PendingChatAttachment[]>([]);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceLanguageId, setVoiceLanguageId] = useState("auto");
  const [voiceReplies, setVoiceReplies] = useState(false);
  const [voiceCharacter, setVoiceCharacter] = useState<VoiceCharacter>("auto");
  const [voiceTone, setVoiceTone] = useState<VoiceTone>("natural");
  const [availableSpeechVoices, setAvailableSpeechVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");

  // Tool states: Code execution & Image generator
  const [executingBlockId, setExecutingBlockId] = useState<string | null>(null);
  const [codeOutputs, setCodeOutputs] = useState<Record<string, CodeRunOutput>>({});
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageStyle, setImageStyle] = useState("photorealistic");
  const [imageRatio, setImageRatio] = useState("1:1");
  const [generatingImage, setGeneratingImage] = useState(false);
  const [zoomedImageUrl, setZoomedImageUrl] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceTypedContextRef = useRef("");
  const voiceCaptureCancelledRef = useRef(false);
  const voiceAudioContextRef = useRef<AudioContext | null>(null);
  const voiceSilenceTimerRef = useRef<number | null>(null);
  const voicePreferencesRef = useRef({ voiceReplies, voiceLanguageId, voiceCharacter, voiceTone });
  voicePreferencesRef.current = { voiceReplies, voiceLanguageId, voiceCharacter, voiceTone };

  const selectedVoiceLanguage = VOICE_LANGUAGES.find((language) => language.id === voiceLanguageId) ?? VOICE_LANGUAGES[0];
  const latestAssistantResponse = [...messages].reverse().find((message) => message.role === "assistant" && blockText(message.content).trim());

  useEffect(() => () => {
    voiceCaptureCancelledRef.current = true;
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    if (voiceSilenceTimerRef.current !== null) window.clearInterval(voiceSilenceTimerRef.current);
    void voiceAudioContextRef.current?.close();
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const updateVoices = () => setAvailableSpeechVoices(window.speechSynthesis.getVoices());
    updateVoices();
    window.speechSynthesis.addEventListener("voiceschanged", updateVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", updateVoices);
  }, []);

  async function toggleVoiceInput() {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      setVoiceStatus("Finishing your voice message…");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setVoiceStatus("Voice recording is not supported in this browser. Try a current version of Chrome or Edge.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      voiceChunksRef.current = [];
      voiceTypedContextRef.current = input.trim();
      voiceCaptureCancelledRef.current = false;
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]
        .find((candidate) => MediaRecorder.isTypeSupported(candidate));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) voiceChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        voiceCaptureCancelledRef.current = true;
        setVoiceStatus("Microphone recording stopped unexpectedly. Please try again.");
        setIsListening(false);
        if (recorder.state === "recording") recorder.stop();
      };
      recorder.onstop = async () => {
        mediaRecorderRef.current = null;
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        if (voiceSilenceTimerRef.current !== null) window.clearInterval(voiceSilenceTimerRef.current);
        voiceSilenceTimerRef.current = null;
        await voiceAudioContextRef.current?.close().catch(() => undefined);
        voiceAudioContextRef.current = null;
        if (voiceCaptureCancelledRef.current) return;
        setIsListening(false);

        const blob = new Blob(voiceChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        voiceChunksRef.current = [];
        if (blob.size < 1000) {
          setVoiceStatus("No clear audio was captured. Press Speak and try again.");
          return;
        }
        if (blob.size > 10 * 1024 * 1024) {
          setVoiceStatus("That voice message is over 10 MB. Please record a shorter message.");
          return;
        }

        try {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error ?? new Error("Could not read recorded audio"));
            reader.readAsDataURL(blob);
          });
          const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
          const detectedMimeType = (blob.type || "audio/webm").split(";")[0];
          setVoiceStatus("Audio captured. Detecting the spoken language and sending it to DEEP REVERSE…");
          const voicePrompt = [
            voiceTypedContextRef.current,
            "🎙 Voice message",
          ].filter(Boolean).join("\n\n");
          voiceTypedContextRef.current = "";
          void handleSend(undefined, voicePrompt, {
            languageId: voicePreferencesRef.current.voiceLanguageId,
            audio: { base64, mimeType: detectedMimeType },
          });
        } catch {
          setVoiceStatus("Could not prepare the voice message. Please try again.");
        }
      };
      recorder.start(250);
      setIsListening(true);
      setVoiceStatus(voicePreferencesRef.current.voiceLanguageId === "auto"
        ? "Listening for speech in any supported language. Pause to send, or press Finish & send."
        : `Listening for ${selectedVoiceLanguage.label}. Pause to send, or press Finish & send.`);

      const AudioContextConstructor = window.AudioContext;
      if (AudioContextConstructor) {
        const audioContext = new AudioContextConstructor();
        voiceAudioContextRef.current = audioContext;
        void audioContext.resume().catch(() => undefined);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        audioContext.createMediaStreamSource(stream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const startedAt = Date.now();
        let lastVoiceAt = startedAt;
        let speechDetected = false;
        voiceSilenceTimerRef.current = window.setInterval(() => {
          analyser.getFloatTimeDomainData(samples);
          const volume = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
          const now = Date.now();
          if (now - startedAt >= 90_000 && recorder.state === "recording") {
            recorder.stop();
          } else if (volume > 0.018) {
            speechDetected = true;
            lastVoiceAt = now;
          } else if (speechDetected && now - lastVoiceAt >= 1800) {
            if (recorder.state === "recording") recorder.stop();
          }
        }, 250);
      }
    } catch {
      mediaRecorderRef.current = null;
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      setIsListening(false);
      setVoiceStatus("Could not start the microphone. Check browser microphone permissions and try again.");
    }
  }

  function speakAssistantResponse(
    rawText: string,
    languageId = voiceLanguageId,
    character = voiceCharacter,
    tone = voiceTone,
  ) {
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      setVoiceStatus("Spoken replies are not supported in this browser.");
      return;
    }
    const language = VOICE_LANGUAGES.find((item) => item.id === languageId) ?? VOICE_LANGUAGES[0];
    const speechTag = language.speechTag || inferSpeechLocale(rawText);
    const text = rawText
      .replace(/```[\s\S]*?```/g, " Code is included in the response for you to review.")
      .replace(/!\[[^\]]*\]\([^)]+\)/g, " Image included in the response.")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/[>*_~#]/g, "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) {
      setVoiceStatus("There is no readable text in this response.");
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = speechTag;
    const localeVoices = availableSpeechVoices.filter((voice) => voice.lang.toLowerCase() === speechTag.toLowerCase())
      .concat(availableSpeechVoices.filter((voice) => voice.lang.toLowerCase().startsWith(speechTag.slice(0, 2).toLowerCase())
        && voice.lang.toLowerCase() !== speechTag.toLowerCase()));
    const preferredVoice = character === "auto"
      ? undefined
      : localeVoices.find((voice) => VOICE_CHARACTER_HINTS[character].test(voice.name));
    const selectedVoice = preferredVoice ?? localeVoices[0];
    if (selectedVoice) utterance.voice = selectedVoice;

    const toneSettings = VOICE_TONE_SETTINGS[tone];
    const characterPitch = character === "female" ? 1.05 : character === "male" ? 0.95 : 1;
    utterance.rate = toneSettings.rate;
    utterance.pitch = Math.max(0.5, Math.min(2, characterPitch + toneSettings.pitch));

    const characterStatus = character === "auto"
      ? selectedVoice ? `using ${selectedVoice.name}` : "using the browser's default voice"
      : preferredVoice
        ? `using ${character} voice ${preferredVoice.name}`
        : `no clearly labeled ${character} voice is installed for this language; using the closest available voice with adjusted pitch`;
    utterance.onstart = () => {
      setIsSpeaking(true);
      const languageStatus = language.id === "auto" ? `the detected language (${speechTag})` : language.label;
      setVoiceStatus(`Speaking in ${languageStatus}, ${tone} tone, ${characterStatus}…`);
    };
    utterance.onend = () => {
      setIsSpeaking(false);
      setVoiceStatus("Spoken reply finished.");
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      setVoiceStatus("Could not play the spoken reply. Check your browser audio settings.");
    };
    window.speechSynthesis.speak(utterance);
  }

  function stopSpokenReply() {
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
    setVoiceStatus("Spoken reply stopped.");
  }

  const handleApplyWorkspaceFile = useCallback(async (path: string, content: string): Promise<boolean> => {
    const { token, workspace } = workspaceConnection;
    if (!token || !workspace) {
      router.push("/workspace");
      throw new Error("Connect the local agent and choose a project folder first.");
    }
    await applyWorkspaceFile(token, path, content);
    return true;
  }, [workspaceConnection, router]);

  const handleRunWorkspaceCommand = useCallback((command: string) => {
    sessionStorage.setItem(LOCAL_WORKSPACE_COMMAND_KEY, command);
    router.push("/workspace");
  }, [router]);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, user, router]);

  useEffect(() => {
    const draft = sessionStorage.getItem(LOCAL_WORKSPACE_CHAT_DRAFT_KEY);
    if (!draft) return;
    setInput((current) => current.trim() ? `${current.trim()}\n\n${draft}` : draft);
    sessionStorage.removeItem(LOCAL_WORKSPACE_CHAT_DRAFT_KEY);
  }, []);

  useEffect(() => {
    const savedToken = sessionStorage.getItem(LOCAL_AGENT_TOKEN_KEY);
    if (!savedToken) return;
    let cancelled = false;
    localAgentFetch<{ available: boolean; paired: boolean; workspace: LocalWorkspaceConnection["workspace"] }>("/status", savedToken)
      .then((status) => {
        if (cancelled) return;
        setWorkspaceConnection(status.paired
          ? { connected: true, token: savedToken, workspace: status.workspace }
          : { connected: false, token: null, workspace: null });
      })
      .catch(() => {
        if (!cancelled) setWorkspaceConnection({ connected: false, token: null, workspace: null });
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (accessToken) refreshConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming, codeOutputs]);

  async function refreshConversations() {
    if (!accessToken) return;
    try {
      const list = await apiFetch<ConversationSummary[]>("/conversations", { accessToken });
      setConversations(list);
    } catch {
      // Offline fallback
    }
  }

  async function openConversation(id: string) {
    if (!accessToken) return;
    setActiveId(id);
    setPreviewOverride(null);
    setShowPreview(false);
    setMobilePanel("chat");
    setMobileSidebarOpen(false);
    setError(null);
    try {
      const detail = await apiFetch<{ messages: ChatMessage[] }>(`/conversations/${id}`, { accessToken });
      setMessages(detail.messages);
    } catch (err: any) {
      setError(err.message ?? "Failed to load conversation");
    }
  }

  async function deleteConversation(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!accessToken) return;
    try {
      await apiFetch(`/conversations/${id}`, { method: "DELETE", accessToken });
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
        setPreviewOverride(null);
        setShowPreview(false);
      }
      refreshConversations();
    } catch (err: any) {
      setError(err.message ?? "Failed to delete conversation");
    }
  }

  function startNewChat() {
    setActiveId(null);
    setMessages([]);
    setPreviewOverride(null);
    setShowPreview(false);
    setMobilePanel("chat");
    setMobileSidebarOpen(false);
    setError(null);
  }

  function queueChatAttachments(files: FileList | File[]) {
    const accepted = [...attachments];
    const rejected: string[] = [];
    let totalBytes = accepted.reduce((sum, item) => sum + item.file.size, 0);

    for (const file of Array.from(files)) {
      if (accepted.some((item) => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified)) continue;
      const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
      if (!MIME_BY_EXTENSION[extension]) {
        rejected.push(`${file.name}: this file type is not supported`);
        continue;
      }
      if (accepted.length >= MAX_CHAT_ATTACHMENTS) {
        rejected.push(`${file.name}: up to ${MAX_CHAT_ATTACHMENTS} files per message`);
        continue;
      }
      if (!file.size) {
        rejected.push(`${file.name}: the file is empty`);
        continue;
      }
      if (totalBytes + file.size > MAX_CHAT_ATTACHMENT_BYTES) {
        rejected.push(`${file.name}: the total attachment limit is 8 MB per message`);
        continue;
      }
      accepted.push({ id: `${file.name}:${file.size}:${file.lastModified}:${crypto.randomUUID()}`, file });
      totalBytes += file.size;
    }

    setAttachments(accepted);
    setAttachmentMenuOpen(false);
    if (rejected.length) setError(rejected.join(" · "));
    else if (accepted.length) setError(null);
  }

  function removeChatAttachment(id: string) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  async function handleSend(e?: FormEvent, messageOverride?: string, voiceContext?: VoiceSendContext, attachmentOverride?: PendingChatAttachment[]) {
    if (e) e.preventDefault();
    const userText = (messageOverride ?? input).trim();
    const pendingAttachments = attachmentOverride ?? attachments;
    const submissionText = userText || (pendingAttachments.length ? "Please review the attached files and help me with them." : "");
    if ((!submissionText && !pendingAttachments.length) || !accessToken || streaming) return;
    if (submissionText.length > 12000) {
      setError("This message is too large for chat. Attach fewer or smaller project files, then send again.");
      return;
    }

    let attachmentPayload: ChatAttachmentPayload[];
    try {
      attachmentPayload = await Promise.all(pendingAttachments.map(({ file }) => encodeChatAttachment(file)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the selected files.");
      return;
    }

    const submittedWebsite = extractWebsiteArtifact(userText);
    const previousWebsite = [...messages].reverse().find((message) =>
      extractWebsiteArtifact(blockText(message.content))
    );
    const websiteFollowUp = Boolean(previousWebsite && isWebsiteFollowUp(userText));
    const hasWorkspaceContext = userText.includes(WORKSPACE_CONTEXT_MARKER)
      || messages.some((message) => blockText(message.content).includes(WORKSPACE_CONTEXT_MARKER));
    const asksForWebsite = isWebsiteRequest(userText) || websiteFollowUp;
    setInput("");
    setError(null);
    setPreviewOverride(submittedWebsite ? userText : null);
    setShowPreview(Boolean(submittedWebsite));
    setMobilePanel(submittedWebsite ? "preview" : "chat");
    setMessages((prev) => [
      ...prev,
      {
        id: `user-${Date.now()}`,
        role: "user",
        content: [
          { type: "text", text: submissionText },
          ...pendingAttachments.map(({ file }) => ({ type: "attachment", name: file.name, mime_type: attachmentMimeType(file) })),
        ],
      },
    ]);

    setStreaming(true);
    let assistantText = "";
    const assistantId = `assistant-${Date.now()}`;
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: [{ type: "text", text: "" }] }]);

    try {
      await streamChat({
        conversation_id: activeId ?? undefined,
        message: submissionText,
        attachments: attachmentPayload,
        website_builder: asksForWebsite && pendingAttachments.length === 0 && !voiceContext?.audio,
        ...(websiteFollowUp && previousWebsite ? {
          previous_code: extractWebsiteArtifact(blockText(previousWebsite.content))?.html,
        } : {}),
        ...(() => {
          const taskInstructions = hasWorkspaceContext
            ? WORKSPACE_BUILD_INSTRUCTIONS
            : asksForWebsite || voiceContext?.audio ? WEBSITE_BUILD_INSTRUCTIONS : "";
          const voiceInstructions = voiceContext
            ? voiceContext.languageId === "auto"
              ? voiceContext.audio
                ? "Listen to the attached voice message. Automatically identify the language or mixed languages the user speaks, understand and follow the request, and reply in the same language and script. Preserve code-switching and colloquial style; for Tanglish, reply in natural Tamil-English written in Latin letters. Do not translate the user's request unless asked."
                : "This message was transcribed from speech. Detect the language in the transcript and reply in that same language without translating it. Preserve code-switching; if the user speaks Tanglish, reply in natural Tamil-English written in Latin letters."
              : (() => {
                const spokenLanguage = VOICE_LANGUAGES.find((language) => language.id === voiceContext.languageId) ?? selectedVoiceLanguage;
                const sourceDescription = voiceContext.audio
                  ? `The attached voice message is in ${spokenLanguage.label}`
                  : `This message was transcribed from speech in ${spokenLanguage.label}`;
                return `${sourceDescription}. Reply in the same language. For Tanglish, use natural Tamil-English written in Latin letters unless the user asks for Tamil script.`;
              })()
            : "";
          const languageInstructions = voiceContext
            ? voiceInstructions
            : selectedVoiceLanguage.id === "auto"
              ? ""
              : `Reply in ${selectedVoiceLanguage.responseLanguage}. The user selected ${selectedVoiceLanguage.label} as their spoken language. For Tanglish, use natural Tamil-English written in Latin letters unless the user asks for Tamil script.`;
          const systemOverride = [taskInstructions, languageInstructions].filter(Boolean).join("\n\n");
          return {
            ...(systemOverride ? { system_override: systemOverride } : {}),
            ...(voiceContext?.audio ? {
              audio_base64: voiceContext.audio.base64,
              audio_mime_type: voiceContext.audio.mimeType,
            } : {}),
          };
        })(),
      }, accessToken, {
      onStatus: (data) => {
        if (!activeId && data.conversation_id) setActiveId(data.conversation_id);
      },
      onDelta: (text) => {
        assistantText += text;
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: [{ type: "text", text: assistantText }] } : m))
        );
      },
      onDone: () => {
        setStreaming(false);
        if (pendingAttachments.length) {
          const sentIds = new Set(pendingAttachments.map((attachment) => attachment.id));
          setAttachments((current) => current.filter((attachment) => !sentIds.has(attachment.id)));
        }
        if (voiceContext || voicePreferencesRef.current.voiceReplies) {
          speakAssistantResponse(
            assistantText,
            voiceContext?.languageId ?? voicePreferencesRef.current.voiceLanguageId,
            voicePreferencesRef.current.voiceCharacter,
            voicePreferencesRef.current.voiceTone,
          );
        }
        if (extractWebsiteArtifact(assistantText)) {
          setPreviewOverride(assistantText);
          setShowPreview(true);
          setMobilePanel("preview");
        } else if (submittedWebsite) {
          setPreviewOverride(userText);
          setShowPreview(true);
          setMobilePanel("preview");
        } else {
          setPreviewOverride(null);
          setShowPreview(false);
          setMobilePanel("chat");
        }
        refreshConversations();
      },
      onError: (data) => {
        setStreaming(false);
        if (!assistantText.trim()) setMessages((prev) => prev.filter((message) => message.id !== assistantId));
        setError(data?.message ?? "Something went wrong. Please try again.");
        if (submittedWebsite) {
          setPreviewOverride(userText);
          setShowPreview(true);
          setMobilePanel("chat");
        } else {
          setPreviewOverride(null);
          setShowPreview(false);
          setMobilePanel("chat");
        }
      },
      });
    } catch {
      setStreaming(false);
      if (!assistantText.trim()) setMessages((prev) => prev.filter((message) => message.id !== assistantId));
      setError("Could not reach the assistant service. Check that the API is running, then try again.");
      if (submittedWebsite) {
        setPreviewOverride(userText);
        setShowPreview(true);
        setMobilePanel("chat");
      } else {
        setPreviewOverride(null);
        setShowPreview(false);
        setMobilePanel("chat");
      }
    }
  }

  async function handleRunCode(codeBlockId: string, code: string, lang: string) {
    if (!accessToken) return;
    setExecutingBlockId(codeBlockId);
    try {
      const requestedLanguage = lang.trim().toLowerCase();
      const runLanguage = ["js", "javascript", "node"].includes(requestedLanguage)
        ? "javascript"
        : requestedLanguage === "java"
          ? "java"
          : ["cs", "c#", "csharp", "dotnet"].includes(requestedLanguage)
            ? "csharp"
            : "python";
      const res = await apiFetch<CodeRunOutput>("/tools/execute-code", {
        method: "POST",
        accessToken,
        body: JSON.stringify({
          code,
          language: runLanguage,
          timeout: ["java", "csharp"].includes(runLanguage) ? 45.0 : 15.0,
        }),
      });
      setCodeOutputs((prev) => ({ ...prev, [codeBlockId]: res }));
    } catch (err: any) {
      setCodeOutputs((prev) => ({
        ...prev,
        [codeBlockId]: {
          language: lang,
          stdout: "",
          stderr: err.message ?? "Execution failed",
          exit_code: 1,
          duration_ms: 0,
          success: false,
          error: err.message,
        },
      }));
    } finally {
      setExecutingBlockId(null);
    }
  }

  async function handleGenerateImage() {
    if (!imagePrompt.trim() || !accessToken || generatingImage) return;
    setGeneratingImage(true);
    try {
      const res = await apiFetch<GeneratedImage>("/images/generate", {
        method: "POST",
        accessToken,
        body: JSON.stringify({
          prompt: imagePrompt.trim(),
          style: imageStyle,
          aspect_ratio: imageRatio,
        }),
      });

      setIsImageModalOpen(false);
      setImagePrompt("");

      const imageMarkdown = `Generated Artwork for: **"${res.prompt}"** (Style: *${res.style}*, Aspect: *${res.aspect_ratio}*)\n\n![${res.prompt}](${res.image_url})`;
      setMessages((prev) => [
        ...prev,
        {
          id: `img-${Date.now()}`,
          role: "assistant",
          content: [{ type: "text", text: imageMarkdown }],
        },
      ]);
    } catch (err: any) {
      setError(err.message ?? "Failed to generate image");
    } finally {
      setGeneratingImage(false);
    }
  }

  const filteredConversations = conversations.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const latestWebsiteMessage = [...messages].reverse().find((message) => extractWebsiteArtifact(blockText(message.content)));
  const previewText = previewOverride ?? (latestWebsiteMessage ? blockText(latestWebsiteMessage.content) : "");
  const websiteArtifact = extractWebsiteArtifact(previewText);
  const previewIsOpen = showPreview && Boolean(websiteArtifact);
  const closePreview = () => {
    setShowPreview(false);
    setMobilePanel("chat");
  };

  if (loading) {
    return (
      <div style={centeredContainerStyle}>
        <div style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#6366f1" }}>DEEP REVERSE</div>
        <div style={{ fontSize: "0.85rem", color: "#888", marginTop: 8 }}>Initializing secure environment…</div>
      </div>
    );
  }

  return (
    <div style={appContainerStyle}>
      <aside className={`app-sidebar ${mobileSidebarOpen ? "mobile-sidebar-open" : ""}`} style={sidebarStyle}>
        <div style={brandHeaderStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={logoBadgeStyle}>DR</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: "1rem", letterSpacing: "0.5px" }}>DEEP REVERSE</div>
              <div style={{ fontSize: "0.68rem", color: "#10b981", fontWeight: 500 }}>● Unlimited Session Active</div>
            </div>
          </div>
        </div>

        <button onClick={startNewChat} style={newChatButtonStyle}>
          + New Chat
        </button>

        <div style={{ marginTop: "0.75rem", marginBottom: "0.5rem" }}>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search history…"
            style={searchInputStyle}
          />
        </div>

        <div style={conversationListStyle}>
          {filteredConversations.length === 0 ? (
            <div style={{ color: "#666", fontSize: "0.8rem", textAlign: "center", padding: "1.5rem 0" }}>
              {searchQuery ? "No matching chats" : "No previous chats"}
            </div>
          ) : (
            filteredConversations.map((c) => (
              <div
                key={c.id}
                onClick={() => openConversation(c.id)}
                style={{
                  ...conversationItemStyle,
                  background: activeId === c.id ? "#1e293b" : "transparent",
                  color: activeId === c.id ? "#fff" : "#94a3b8",
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                  {c.title || "Untitled Conversation"}
                </span>
                <button
                  onClick={(e) => deleteConversation(c.id, e)}
                  title="Delete chat"
                  style={deleteChatBtnStyle}
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>

        <div style={sidebarFooterStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, flex: 1 }}>
            <div style={userAvatarStyle}>{user?.display_name?.charAt(0).toUpperCase() ?? "U"}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {user?.display_name}
              </div>
              <div title={user?.email} style={{ fontSize: "0.72rem", color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {user?.email}
              </div>
            </div>
          </div>
          <button onClick={logout} style={logoutButtonStyle} title="Sign Out">
            Logout
          </button>
        </div>
      </aside>
      {mobileSidebarOpen && (
        <button className="mobile-sidebar-backdrop" onClick={() => setMobileSidebarOpen(false)} aria-label="Close chat menu" />
      )}

      <main style={mainContentStyle}>
        <header className="top-header" style={topHeaderStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button className="mobile-menu-button" onClick={() => setMobileSidebarOpen((open) => !open)} aria-label="Open chat menu">☰</button>
            <span className="header-title" style={{ fontWeight: 600, fontSize: "0.95rem", color: "#f8fafc" }}>
              {activeId ? "DEEP REVERSE Multimodal Assistant" : "DEEP REVERSE — Intelligence Workspace"}
            </span>
            <span className="pill-badge" style={pillBadgeStyle}>Multilingual & Mindset Mirroring</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              onClick={() => router.push("/workspace")}
              className="tool-header-button"
              style={toolHeaderBtnStyle}
                title="Open your project files and in-app terminal"
            >
              🗂 {workspaceConnection.workspace ? workspaceConnection.workspace.name : "Project Workspace"}
            </button>
            {websiteArtifact && (
              <>
                <div className="mobile-workspace-switch" role="group" aria-label="Workspace panel">
                  <button className={mobilePanel === "chat" ? "selected" : ""} onClick={() => setMobilePanel("chat")}>Chat</button>
                  <button className={mobilePanel === "preview" ? "selected" : ""} onClick={() => { setShowPreview(true); setMobilePanel("preview"); }}>Preview</button>
                </div>
                <button
                  className="desktop-preview-toggle"
                  style={toolHeaderBtnStyle}
                  onClick={() => (previewIsOpen ? closePreview() : setShowPreview(true))}
                >
                  {previewIsOpen ? "Close Preview" : "Open Preview"}
                </button>
              </>
            )}
            <button
              onClick={() => router.push("/video-studio")}
              className="tool-header-button"
              style={toolHeaderBtnStyle}
              title="Edit and create videos from prompts"
            >
              🎬 Video Studio
            </button>
            <button
              onClick={() => setIsImageModalOpen(true)}
              className="tool-header-button"
              style={toolHeaderBtnStyle}
              title="Generate AI Images"
            >
              🎨 Image Studio
            </button>
          </div>
        </header>

        <div className={`chat-workspace ${previewIsOpen ? "with-preview" : "chat-only"} mobile-panel-${mobilePanel}`}>
        <section className="conversation-workspace">
        <div style={messageContainerStyle}>
          {messages.length === 0 && (
            <div style={emptyStateContainerStyle}>
              <div style={emptyStateIconStyle}>⚡</div>
              <h2 style={{ fontSize: "1.5rem", fontWeight: 700, margin: "0.5rem 0", color: "#f8fafc" }}>
                DEEP REVERSE
              </h2>
              <p style={{ color: "#94a3b8", maxWidth: "550px", fontSize: "0.9rem", lineHeight: 1.6 }}>
                Advanced AI assistant for sandboxed code execution, step-by-step verified mathematics, data analytics, and visual image generation.
                Conversations are unlimited and automatically mirror your language (English, தமிழ், हिंदी, Español, etc.) and cognitive style.
              </p>

              <div style={quickCardsGridStyle}>
                <button
                  onClick={() => handleSend(undefined, "Solve the system of equations: 3x + 4y = 25 and 2x - y = 9 with step-by-step mathematical reasoning.")}
                  style={quickCardStyle}
                >
                  <div style={{ fontWeight: 600, color: "#38bdf8", marginBottom: "4px" }}>📐 Solve Mathematics</div>
                  <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>Step-by-step algebraic & calculus derivations</div>
                </button>

                <button
                  onClick={() => handleSend(undefined, "Write and execute a Python script to calculate Fibonacci sequence up to 15 terms and compute prime numbers under 50.")}
                  style={quickCardStyle}
                >
                  <div style={{ fontWeight: 600, color: "#34d399", marginBottom: "4px" }}>💻 Code Execution Sandbox</div>
                  <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>Run Python/JS algorithms and view real-time output</div>
                </button>

                <button
                  onClick={() => handleSend(undefined, "Create a polished, responsive website for an independent creative studio. Include a strong hero section, services, selected work, testimonials, and a contact call to action.")}
                  style={quickCardStyle}
                >
                  <div style={{ fontWeight: 600, color: "#c4b5fd", marginBottom: "4px" }}>✦ Build a Website</div>
                  <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>Generate a responsive page and preview it live</div>
                </button>

                <button
                  onClick={() => handleSend(undefined, "Analyze this dataset and compute descriptive statistics:\nProduct,Sales,Revenue,Profit\nA,120,24000,6000\nB,85,17000,4250\nC,210,42000,12600\nD,45,9000,1800")}
                  style={quickCardStyle}
                >
                  <div style={{ fontWeight: 600, color: "#fbbf24", marginBottom: "4px" }}>📊 Data Analytics</div>
                  <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>Descriptive stats, distributions & markdown tables</div>
                </button>
              </div>
            </div>
          )}

          {messages.map((m, mIdx) => {
            const raw = blockText(m.content);
            const isUser = m.role === "user";
            return (
              <div key={m.id || mIdx} style={{ marginBottom: "1.5rem", display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px", fontSize: "0.75rem", color: "#64748b" }}>
                  <span>{isUser ? user?.display_name ?? "User" : "DEEP REVERSE"}</span>
                </div>

                <div
                  style={{
                    maxWidth: "85%",
                    padding: "1rem 1.25rem",
                    borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                    background: isUser ? "#3b82f6" : "#1e293b",
                    color: isUser ? "#ffffff" : "#f1f5f9",
                    lineHeight: 1.6,
                    fontSize: "0.95rem",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                  }}
                >
                  {isUser ? (
                    <>
                      <div style={{ whiteSpace: "pre-wrap" }}>{raw}</div>
                      {m.content.filter((block) => block.type === "attachment" && block.name).map((block, index) => (
                        <div key={`${block.name}-${index}`} className="chat-message-attachment">📎 {block.name}</div>
                      ))}
                    </>
                  ) : (
                    <RenderAssistantContent
                      rawText={raw}
                      streaming={streaming && mIdx === messages.length - 1}
                      onRunCode={handleRunCode}
                      executingBlockId={executingBlockId}
                      codeOutputs={codeOutputs}
                      onZoomImage={(url) => setZoomedImageUrl(url)}
                      onPreviewWebsite={(text) => {
                        setPreviewOverride(text);
                        setShowPreview(true);
                        setMobilePanel("preview");
                      }}
                      workspaceAvailable={Boolean(workspaceConnection.connected && workspaceConnection.workspace)}
                      onApplyWorkspaceFile={handleApplyWorkspaceFile}
                      onRunWorkspaceCommand={handleRunWorkspaceCommand}
                    />
                  )}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {error && (
          <div style={errorBannerStyle}>
            ⚠️ {error}
          </div>
        )}

        <div style={inputContainerStyle}>
          <form onSubmit={handleSend} style={formStyle}>
            <div className="chat-input-main">
              <div className="chat-voice-controls">
                <label className="chat-voice-language">
                  <span>Voice & reply language</span>
                  <select value={voiceLanguageId} onChange={(event) => setVoiceLanguageId(event.target.value)} disabled={streaming || isListening}>
                    {VOICE_LANGUAGES.map((language) => <option key={language.id} value={language.id}>{language.label}</option>)}
                  </select>
                </label>
                <label className="chat-voice-language">
                  <span>Voice character</span>
                  <select value={voiceCharacter} onChange={(event) => setVoiceCharacter(event.target.value as VoiceCharacter)} disabled={streaming || isListening}>
                    <option value="auto">Auto</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                  </select>
                </label>
                <label className="chat-voice-language">
                  <span>Tone</span>
                  <select value={voiceTone} onChange={(event) => setVoiceTone(event.target.value as VoiceTone)} disabled={streaming || isListening}>
                    <option value="natural">Natural</option>
                    <option value="calm">Calm</option>
                    <option value="friendly">Friendly</option>
                    <option value="energetic">Energetic</option>
                    <option value="professional">Professional</option>
                  </select>
                </label>
                <button
                  type="button"
                  className={`chat-voice-button ${voiceReplies ? "selected" : ""}`}
                  onClick={() => {
                    const enableReplies = !voiceReplies;
                    setVoiceReplies(enableReplies);
                    if (!enableReplies) stopSpokenReply();
                    setVoiceStatus(enableReplies ? "Automatic spoken replies are on." : "Automatic spoken replies are off.");
                  }}
                  aria-pressed={voiceReplies}
                  title="Automatically read text-chat replies. Voice turns are read aloud automatically."
                >
                  {voiceReplies ? "🔊 Auto-read on" : "🔈 Auto-read off"}
                </button>
                {latestAssistantResponse && (
                  <button
                    type="button"
                    className="chat-voice-button"
                    onClick={() => speakAssistantResponse(blockText(latestAssistantResponse.content))}
                    disabled={streaming}
                    title="Read the latest assistant response aloud."
                  >
                    🔊 Hear latest
                  </button>
                )}
                {isSpeaking && <button type="button" className="chat-voice-button" onClick={stopSpokenReply}>Stop audio</button>}
                {voiceStatus && <span className="chat-voice-status" role="status">{voiceStatus}</span>}
              </div>
              <div className="chat-voice-guidance">Female and male options use matching voices available in your browser; tone adjusts speaking speed and pitch.</div>
              <div className="chat-composer">
                {attachments.length > 0 && (
                  <div className="chat-attachment-chips" aria-label="Files attached to this message">
                    {attachments.map(({ id, file }) => (
                      <div className="chat-attachment-chip" key={id} title={`${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`}>
                        <span>📎</span><span>{file.name}</span>
                        <button type="button" onClick={() => removeChatAttachment(id)} disabled={streaming} aria-label={`Remove ${file.name}`}>×</button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="chat-composer-row">
                  <div className="chat-attachment-picker">
                    <button
                      type="button"
                      className="chat-composer-icon-button chat-attach-button"
                      onClick={() => setAttachmentMenuOpen((open) => !open)}
                      disabled={streaming || isListening}
                      aria-label="Add photos, files, or documents"
                      aria-haspopup="menu"
                      aria-expanded={attachmentMenuOpen}
                      title="Add photos, files, or documents from this computer"
                    >+</button>
                    {attachmentMenuOpen && (
                      <div className="chat-attachment-menu" role="menu" aria-label="Choose an attachment type">
                        <div className="chat-attachment-menu-title">Add to this message</div>
                        <button type="button" role="menuitem" onClick={() => { setAttachmentMenuOpen(false); photoInputRef.current?.click(); }}>
                          <span>🖼️</span><span><strong>Photos</strong><small>Images from this computer</small></span>
                        </button>
                        <button type="button" role="menuitem" onClick={() => { setAttachmentMenuOpen(false); fileInputRef.current?.click(); }}>
                          <span>📁</span><span><strong>Files</strong><small>Choose a file from your computer</small></span>
                        </button>
                        <button type="button" role="menuitem" onClick={() => { setAttachmentMenuOpen(false); documentInputRef.current?.click(); }}>
                          <span>📄</span><span><strong>Documents</strong><small>PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), text</small></span>
                        </button>
                        <div className="chat-attachment-menu-note">Files are sent to your configured AI provider when you send the message.</div>
                      </div>
                    )}
                    <input ref={photoInputRef} className="chat-hidden-file-input" type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp,image/heic,image/heif" onChange={(event) => { if (event.currentTarget.files) queueChatAttachments(event.currentTarget.files); event.currentTarget.value = ""; }} />
                    <input ref={fileInputRef} className="chat-hidden-file-input" type="file" multiple onChange={(event) => { if (event.currentTarget.files) queueChatAttachments(event.currentTarget.files); event.currentTarget.value = ""; }} />
                    <input ref={documentInputRef} className="chat-hidden-file-input" type="file" multiple accept=".pdf,.docx,.xlsx,.pptx,.txt,.md,.csv,.json,.jsonl,.xml,.html,.css,.js,.ts,.tsx,.py" onChange={(event) => { if (event.currentTarget.files) queueChatAttachments(event.currentTarget.files); event.currentTarget.value = ""; }} />
                  </div>
                  <textarea
                    className="chat-composer-textarea"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder="Ask DEEP REVERSE anything in any language or paste code…"
                    rows={2}
                    disabled={streaming || isListening}
                    style={textareaStyle}
                  />
                  <button
                    type="button"
                    className={`chat-composer-icon-button chat-microphone-button ${isListening ? "active" : ""}`}
                    onClick={toggleVoiceInput}
                    disabled={streaming}
                    aria-label={isListening ? "Finish and send voice message" : "Start speaking"}
                    aria-pressed={isListening}
                    title={isListening ? "Finish and send voice message" : "Speak in your selected language; DEEP REVERSE will reply in that language"}
                  >{isListening ? "■" : "🎙️"}</button>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <button
                type="submit"
                disabled={streaming || (!input.trim() && !attachments.length)}
                style={{
                  ...sendButtonStyle,
                  opacity: streaming || (!input.trim() && !attachments.length) ? 0.6 : 1,
                  cursor: streaming || (!input.trim() && !attachments.length) ? "not-allowed" : "pointer",
                }}
              >
                {streaming ? "Streaming…" : "Send ➔"}
              </button>
              <button
                type="button"
                onClick={() => setIsImageModalOpen(true)}
                title="Create Image"
                style={imageIconButtonStyle}
              >
                🎨 Image
              </button>
            </div>
          </form>
          <div style={{ fontSize: "0.72rem", color: "#64748b", textAlign: "center", marginTop: "6px" }}>
            DEEP REVERSE • Live website preview • Code sandbox • Math & data engine
          </div>
        </div>
        </section>
        {previewIsOpen && websiteArtifact && <SitePreview artifact={websiteArtifact} onClose={closePreview} />}
        </div>
      </main>

      {isImageModalOpen && (
        <div style={modalBackdropStyle} onClick={() => setIsImageModalOpen(false)}>
          <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700, color: "#f8fafc" }}>
                🎨 DEEP REVERSE Image Studio
              </h3>
              <button onClick={() => setIsImageModalOpen(false)} style={modalCloseBtnStyle}>✕</button>
            </div>

            <div style={{ marginBottom: "1rem" }}>
              <label style={labelStyle}>Image Prompt / Description:</label>
              <textarea
                value={imagePrompt}
                onChange={(e) => setImagePrompt(e.target.value)}
                placeholder="E.g., A majestic cybernetic tiger walking through a rain-soaked neon cyberpunk alley..."
                rows={3}
                style={modalTextareaStyle}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.25rem" }}>
              <div>
                <label style={labelStyle}>Artistic Style:</label>
                <select
                  value={imageStyle}
                  onChange={(e) => setImageStyle(e.target.value)}
                  style={selectStyle}
                >
                  <option value="photorealistic">Photorealistic (8k)</option>
                  <option value="cinematic">Cinematic Atmosphere</option>
                  <option value="anime">Vibrant Anime / Manga</option>
                  <option value="cyberpunk">Cyberpunk Neon</option>
                  <option value="3d_render">3D Pixar / Unreal 5</option>
                  <option value="fantasy">High Fantasy</option>
                  <option value="minimalist">Minimalist Vector</option>
                </select>
              </div>

              <div>
                <label style={labelStyle}>Aspect Ratio:</label>
                <select
                  value={imageRatio}
                  onChange={(e) => setImageRatio(e.target.value)}
                  style={selectStyle}
                >
                  <option value="1:1">1:1 Square (1024x1024)</option>
                  <option value="16:9">16:9 Widescreen (1280x720)</option>
                  <option value="9:16">9:16 Portrait / Story (720x1280)</option>
                  <option value="4:3">4:3 Standard (1024x768)</option>
                  <option value="3:2">3:2 Classic Photo (1080x720)</option>
                </select>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button
                type="button"
                onClick={() => setIsImageModalOpen(false)}
                style={cancelBtnStyle}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleGenerateImage}
                disabled={generatingImage || !imagePrompt.trim()}
                style={{
                  ...generateImageBtnStyle,
                  opacity: generatingImage || !imagePrompt.trim() ? 0.6 : 1,
                }}
              >
                {generatingImage ? "Generating Image…" : "Generate Artwork 🎨"}
              </button>
            </div>
          </div>
        </div>
      )}

      {zoomedImageUrl && (
        <div style={modalBackdropStyle} onClick={() => setZoomedImageUrl(null)}>
          <div style={{ position: "relative", maxWidth: "90vw", maxHeight: "90vh" }} onClick={(e) => e.stopPropagation()}>
            <img
              src={zoomedImageUrl}
              alt="Zoomed"
              style={{ maxWidth: "90vw", maxHeight: "85vh", borderRadius: "12px", boxShadow: "0 20px 40px rgba(0,0,0,0.8)" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px" }}>
              <a
                href={zoomedImageUrl}
                target="_blank"
                rel="noreferrer"
                download="deep-reverse-artwork.jpg"
                style={downloadLinkStyle}
              >
                ⬇️ Download Full Resolution
              </a>
              <button onClick={() => setZoomedImageUrl(null)} style={modalCloseBtnStyle}>✕ Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RenderAssistantContent({
  rawText,
  streaming,
  onRunCode,
  executingBlockId,
  codeOutputs,
  onZoomImage,
  onPreviewWebsite,
  workspaceAvailable,
  onApplyWorkspaceFile,
  onRunWorkspaceCommand,
}: {
  rawText: string;
  streaming: boolean;
  onRunCode: (blockId: string, code: string, lang: string) => void;
  executingBlockId: string | null;
  codeOutputs: Record<string, CodeRunOutput>;
  onZoomImage: (url: string) => void;
  onPreviewWebsite: (text: string) => void;
  workspaceAvailable: boolean;
  onApplyWorkspaceFile: (path: string, content: string) => Promise<boolean>;
  onRunWorkspaceCommand: (command: string) => void;
}) {
  const [workspaceFileStatus, setWorkspaceFileStatus] = useState<Record<string, string>>({});
  if (!rawText && streaming) {
    return <span style={{ color: "#94a3b8" }}>DEEP REVERSE is thinking…</span>;
  }

  const parts = rawText.split(/(```[\s\S]*?```)/g);

  return (
    <div>
      {parts.map((part, idx) => {
        if (part.startsWith("```") && part.endsWith("```")) {
          const lines = part.slice(3, -3).split("\n");
          const firstLine = lines[0].trim();
          const workspaceFilePath = firstLine.match(/^workspace-file:(.+)$/i)?.[1]?.trim();
          const language = workspaceFilePath ? workspaceFilePath.split(".").at(-1) || "text" : firstLine || "python";
          const code = lines.slice(1).join("\n");
          const blockId = `code-block-${idx}`;
          const isExecuting = executingBlockId === blockId;
          const output = codeOutputs[blockId];
          const missingVariable = output && !output.success
            ? (output.stderr || output.error || "").match(/NameError: name ['\"]([^'\"]+)['\"] is not defined/)
            : null;
          const missingModule = output && !output.success
            ? (output.stderr || output.error || "").match(/ModuleNotFoundError: No module named ['\"]([^'\"]+)['\"]/)
            : null;
          const canRun = [
            "py", "python", "python3", "js", "javascript", "node", "java", "cs", "c#", "csharp", "dotnet",
          ].includes(language.toLowerCase());
          const isPowerShell = ["powershell", "pwsh", "ps1"].includes(language.toLowerCase());
          const canPreview = ["html", "html5", "htm"].includes(language.toLowerCase()) && extractWebsiteArtifact(rawText) !== null;
          const saveStatus = workspaceFilePath ? workspaceFileStatus[workspaceFilePath] : "";

          return (
            <div key={idx} style={codeBlockContainerStyle}>
              <div style={codeHeaderStyle}>
                <span style={{ fontWeight: 600, fontSize: "0.75rem", color: "#38bdf8", textTransform: "uppercase" }}>
                  {language}
                </span>
                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    onClick={() => navigator.clipboard.writeText(code)}
                    style={codeActionButtonStyle}
                    title="Copy Code"
                  >
                    📋 Copy
                  </button>
                  {workspaceFilePath && (
                    <button
                      onClick={async () => {
                        setWorkspaceFileStatus((current) => ({ ...current, [workspaceFilePath]: "Saving…" }));
                        try {
                          const saved = await onApplyWorkspaceFile(workspaceFilePath, code);
                          setWorkspaceFileStatus((current) => ({ ...current, [workspaceFilePath]: saved ? "Saved" : "Canceled" }));
                        } catch (err) {
                          const message = err instanceof Error ? err.message : "Could not save file.";
                          setWorkspaceFileStatus((current) => ({ ...current, [workspaceFilePath]: message }));
                          window.alert(message);
                        }
                      }}
                      disabled={!workspaceAvailable || saveStatus === "Saving…"}
                      style={{ ...codeActionButtonStyle, color: workspaceAvailable ? "#86efac" : "#64748b" }}
                      title={workspaceAvailable ? `Review and save ${workspaceFilePath} in the selected project` : "Connect Project Workspace and choose a folder first"}
                    >
                      {saveStatus === "Saved" ? "✓ Saved" : "Apply file"}
                    </button>
                  )}
                  {canPreview && (
                    <button
                      onClick={() => onPreviewWebsite(rawText)}
                      style={{ ...codeRunButtonStyle, background: "#6554c0" }}
                      title="Show this page in the website preview"
                    >
                      ◉ Preview
                    </button>
                  )}
                  {canRun && (
                    <button
                      onClick={() => onRunCode(blockId, code, language)}
                      disabled={isExecuting}
                      style={{
                        ...codeRunButtonStyle,
                        background: isExecuting ? "#475569" : "#10b981",
                      }}
                      title="Execute in sandbox"
                    >
                      {isExecuting ? "⏳ Running…" : "▶ Run Code"}
                    </button>
                  )}
                  {isPowerShell && (
                    <button
                      onClick={() => onRunWorkspaceCommand(code)}
                      disabled={!workspaceAvailable}
                      style={{ ...codeRunButtonStyle, background: workspaceAvailable ? "#b45309" : "#475569" }}
                      title={workspaceAvailable ? "Run this visible command in the DEEP REVERSE project terminal" : "Connect Project Workspace and choose a folder first"}
                    >
                      ▶ Run in DEEP REVERSE
                    </button>
                  )}
                </div>
              </div>

              <pre style={preStyle}>
                <code>{code}</code>
              </pre>

              {output && (
                <div style={consoleOutputPanelStyle}>
                  <div style={consoleHeaderStyle}>
                    <span style={{ color: output.success ? "#34d399" : "#f87171", fontWeight: 600 }}>
                      {output.success ? "✓ Execution Succeeded" : "✕ Execution Error"} (exit: {output.exit_code})
                    </span>
                    <span style={{ color: "#64748b" }}>{output.duration_ms} ms</span>
                  </div>
                  {output.stdout && (
                    <div style={{ color: "#f8fafc", whiteSpace: "pre-wrap", marginBottom: "4px" }}>
                      {output.stdout}
                    </div>
                  )}
                  {output.stderr && (
                    <>
                      {missingVariable && (
                        <div style={{ color: "#fde68a", marginBottom: "8px" }}>
                          This code uses <code>{missingVariable[1]}</code> before it is defined. Each code block runs in a fresh process, so add the variable setup or load the data in this same block.
                        </div>
                      )}
                      {missingModule && (
                        <div style={{ color: "#fde68a", marginBottom: "8px" }}>
                          This code needs <code>{missingModule[1]}</code>, which is not installed in the Run Code environment. Use Python's built-in libraries, or ask an administrator to add the package to the code runner.
                        </div>
                      )}
                      <div style={{ color: "#fca5a5", whiteSpace: "pre-wrap" }}>
                        {output.stderr}
                      </div>
                    </>
                  )}
                  {output.images?.map((image, imageIndex) => (
                    <img
                      key={imageIndex}
                      src={image}
                      alt={`Chart generated by the code, ${imageIndex + 1}`}
                      style={{ display: "block", maxWidth: "100%", height: "auto", marginTop: "12px", borderRadius: "8px" }}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        }

        return <RenderTextWithImages key={idx} text={part} onZoomImage={onZoomImage} />;
      })}
    </div>
  );
}

function RenderTextWithImages({
  text,
  onZoomImage,
}: {
  text: string;
  onZoomImage: (url: string) => void;
}) {
  const imageRegex = /!\[(.*?)\]\((https?:\/\/[^\s)]+)\)/g;
  const segments = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = imageRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: "image", alt: match[1], url: match[2] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "image" && seg.url) {
          return (
            <div key={i} style={imageCardContainerStyle}>
              <img
                src={seg.url}
                alt={seg.alt || "Generated Artwork"}
                style={imagePreviewStyle}
                onClick={() => onZoomImage(seg.url!)}
              />
              <div style={imageCardFooterStyle}>
                <span style={{ fontSize: "0.8rem", color: "#cbd5e1" }}>{seg.alt || "DEEP REVERSE Artwork"}</span>
                <button onClick={() => onZoomImage(seg.url!)} style={zoomBtnStyle}>
                  🔍 Zoom / Download
                </button>
              </div>
            </div>
          );
        }
        return <div key={i} style={{ whiteSpace: "pre-wrap", marginBottom: "0.5rem" }}>{seg.content}</div>;
      })}
    </>
  );
}

const appContainerStyle: React.CSSProperties = {
  display: "flex",
  height: "100vh",
  fontFamily: "Inter, system-ui, -apple-system, sans-serif",
  background: "#0f172a",
  color: "#f8fafc",
};

const centeredContainerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "100vh",
  background: "#0f172a",
};

const sidebarStyle: React.CSSProperties = {
  width: 280,
  background: "#090d16",
  borderRight: "1px solid #1e293b",
  padding: "1rem",
  display: "flex",
  flexDirection: "column",
};

const brandHeaderStyle: React.CSSProperties = {
  paddingBottom: "1rem",
  borderBottom: "1px solid #1e293b",
  marginBottom: "1rem",
};

const logoBadgeStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 8,
  background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 800,
  fontSize: "0.9rem",
  color: "#fff",
};

const newChatButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.7rem",
  borderRadius: 8,
  background: "linear-gradient(135deg, #2563eb, #4f46e5)",
  color: "#fff",
  border: "none",
  fontWeight: 600,
  fontSize: "0.9rem",
  cursor: "pointer",
  transition: "all 0.2s ease",
};

const searchInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  borderRadius: 6,
  background: "#1e293b",
  border: "1px solid #334155",
  color: "#f8fafc",
  fontSize: "0.8rem",
};

const conversationListStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  marginTop: "0.5rem",
  display: "flex",
  flexDirection: "column",
  gap: "4px",
};

const conversationItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0.6rem 0.75rem",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: "0.85rem",
  transition: "background 0.15s ease",
};

const deleteChatBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#64748b",
  fontSize: "0.75rem",
  cursor: "pointer",
  padding: "2px 6px",
  borderRadius: 4,
};

const sidebarFooterStyle: React.CSSProperties = {
  borderTop: "1px solid #1e293b",
  paddingTop: "0.75rem",
  marginTop: "auto",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
};

const userAvatarStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  flex: "0 0 28px",
  borderRadius: "50%",
  background: "#3b82f6",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 700,
  fontSize: "0.8rem",
};

const logoutButtonStyle: React.CSSProperties = {
  background: "none",
  border: "1px solid #334155",
  color: "#94a3b8",
  borderRadius: 6,
  padding: "0.3rem 0.6rem",
  fontSize: "0.75rem",
  cursor: "pointer",
  flexShrink: 0,
};

const mainContentStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  background: "#0b1120",
  position: "relative",
};

const topHeaderStyle: React.CSSProperties = {
  height: 56,
  borderBottom: "1px solid #1e293b",
  padding: "0 1.5rem",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  background: "#0f172a",
};

const pillBadgeStyle: React.CSSProperties = {
  fontSize: "0.7rem",
  padding: "0.2rem 0.6rem",
  borderRadius: 12,
  background: "rgba(59, 130, 246, 0.15)",
  color: "#60a5fa",
  border: "1px solid rgba(59, 130, 246, 0.3)",
};

const toolHeaderBtnStyle: React.CSSProperties = {
  padding: "0.4rem 0.8rem",
  borderRadius: 6,
  background: "#1e293b",
  border: "1px solid #334155",
  color: "#f8fafc",
  fontSize: "0.8rem",
  fontWeight: 500,
  cursor: "pointer",
};

const messageContainerStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "1.5rem",
};

const emptyStateContainerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  textAlign: "center",
  padding: "2rem",
};

const emptyStateIconStyle: React.CSSProperties = {
  width: 54,
  height: 54,
  borderRadius: 14,
  background: "linear-gradient(135deg, #3b82f6, #9333ea)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "1.6rem",
  color: "#fff",
};

const quickCardsGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "0.75rem",
  maxWidth: "600px",
  width: "100%",
  marginTop: "1.5rem",
};

const quickCardStyle: React.CSSProperties = {
  padding: "0.85rem 1rem",
  borderRadius: 10,
  background: "#1e293b",
  border: "1px solid #334155",
  textAlign: "left",
  cursor: "pointer",
  transition: "all 0.2s ease",
};

const inputContainerStyle: React.CSSProperties = {
  padding: "1rem 1.5rem",
  borderTop: "1px solid #1e293b",
  background: "#0f172a",
};

const formStyle: React.CSSProperties = {
  display: "flex",
  gap: "0.75rem",
  alignItems: "flex-end",
};

const textareaStyle: React.CSSProperties = {
  flex: 1,
  padding: "0.45rem 0.55rem",
  borderRadius: 6,
  background: "transparent",
  border: 0,
  color: "#f8fafc",
  fontSize: "0.95rem",
  resize: "none",
  fontFamily: "inherit",
  outline: "none",
};

const sendButtonStyle: React.CSSProperties = {
  padding: "0.7rem 1.25rem",
  borderRadius: 8,
  background: "#3b82f6",
  color: "#fff",
  border: "none",
  fontWeight: 600,
  fontSize: "0.9rem",
  cursor: "pointer",
};

const imageIconButtonStyle: React.CSSProperties = {
  padding: "0.4rem 0.8rem",
  borderRadius: 6,
  background: "#1e293b",
  border: "1px solid #334155",
  color: "#ec4899",
  fontSize: "0.75rem",
  fontWeight: 600,
  cursor: "pointer",
};

const errorBannerStyle: React.CSSProperties = {
  padding: "0.6rem 1.5rem",
  background: "#7f1d1d",
  color: "#fecaca",
  fontSize: "0.85rem",
};

const codeBlockContainerStyle: React.CSSProperties = {
  margin: "0.75rem 0",
  borderRadius: 8,
  background: "#030712",
  border: "1px solid #1f2937",
  overflow: "hidden",
};

const codeHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0.4rem 0.8rem",
  background: "#111827",
  borderBottom: "1px solid #1f2937",
};

const codeActionButtonStyle: React.CSSProperties = {
  padding: "0.25rem 0.55rem",
  borderRadius: 4,
  background: "#1f2937",
  color: "#9ca3af",
  border: "none",
  fontSize: "0.7rem",
  cursor: "pointer",
};

const codeRunButtonStyle: React.CSSProperties = {
  padding: "0.25rem 0.65rem",
  borderRadius: 4,
  color: "#fff",
  border: "none",
  fontSize: "0.72rem",
  fontWeight: 600,
  cursor: "pointer",
};

const preStyle: React.CSSProperties = {
  margin: 0,
  padding: "0.85rem 1rem",
  overflowX: "auto",
  fontSize: "0.85rem",
  fontFamily: "Fira Code, Menlo, Monaco, Consolas, monospace",
  color: "#e2e8f0",
  lineHeight: 1.5,
};

const consoleOutputPanelStyle: React.CSSProperties = {
  padding: "0.65rem 0.9rem",
  background: "#090d16",
  borderTop: "1px solid #1e293b",
  fontFamily: "Fira Code, monospace",
  fontSize: "0.8rem",
};

const consoleHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  marginBottom: "4px",
  fontSize: "0.72rem",
};

const imageCardContainerStyle: React.CSSProperties = {
  margin: "0.85rem 0",
  borderRadius: 10,
  overflow: "hidden",
  background: "#030712",
  border: "1px solid #334155",
  maxWidth: "500px",
};

const imagePreviewStyle: React.CSSProperties = {
  width: "100%",
  height: "auto",
  display: "block",
  cursor: "zoom-in",
};

const imageCardFooterStyle: React.CSSProperties = {
  padding: "0.5rem 0.85rem",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  background: "#0f172a",
};

const zoomBtnStyle: React.CSSProperties = {
  background: "#1e293b",
  border: "1px solid #334155",
  color: "#60a5fa",
  borderRadius: 4,
  padding: "0.25rem 0.55rem",
  fontSize: "0.75rem",
  cursor: "pointer",
};

const modalBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.75)",
  backdropFilter: "blur(4px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
};

const modalCardStyle: React.CSSProperties = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 14,
  padding: "1.5rem",
  maxWidth: "520px",
  width: "90%",
  boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
};

const modalCloseBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#94a3b8",
  fontSize: "1rem",
  cursor: "pointer",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.8rem",
  fontWeight: 600,
  color: "#cbd5e1",
  marginBottom: "4px",
};

const modalTextareaStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.6rem 0.8rem",
  borderRadius: 8,
  background: "#0f172a",
  border: "1px solid #334155",
  color: "#f8fafc",
  fontSize: "0.9rem",
  resize: "none",
  fontFamily: "inherit",
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  borderRadius: 8,
  background: "#0f172a",
  border: "1px solid #334155",
  color: "#f8fafc",
  fontSize: "0.85rem",
};

const cancelBtnStyle: React.CSSProperties = {
  padding: "0.5rem 1rem",
  borderRadius: 6,
  background: "transparent",
  border: "1px solid #475569",
  color: "#cbd5e1",
  cursor: "pointer",
  fontSize: "0.85rem",
};

const generateImageBtnStyle: React.CSSProperties = {
  padding: "0.5rem 1.25rem",
  borderRadius: 6,
  background: "linear-gradient(135deg, #ec4899, #8b5cf6)",
  color: "#fff",
  border: "none",
  fontWeight: 600,
  cursor: "pointer",
  fontSize: "0.85rem",
};

const downloadLinkStyle: React.CSSProperties = {
  color: "#60a5fa",
  fontSize: "0.85rem",
  textDecoration: "none",
  fontWeight: 500,
};
