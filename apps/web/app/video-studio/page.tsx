"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api";

type EditSettings = {
  start: number;
  end: number;
  speed: number;
  filter: "none" | "cinematic" | "mono" | "warm" | "cool" | "vivid";
  ratio: "source" | "16:9" | "9:16" | "1:1";
  title: string;
  brightness: number;
  contrast: number;
  saturation: number;
};
type VideoStudioMode = "clip" | "graphic" | "generate";
type VideoJob = { id: string; status: "queued" | "generating" | "complete" | "failed"; message: string };

const INITIAL_SETTINGS: EditSettings = { start: 0, end: 0, speed: 1, filter: "none", ratio: "source", title: "", brightness: 100, contrast: 100, saturation: 100 };
const FILTER_CSS: Record<EditSettings["filter"], string> = {
  none: "none",
  cinematic: "contrast(1.18) saturate(1.16) brightness(.96)",
  mono: "grayscale(1) contrast(1.08)",
  warm: "sepia(.22) saturate(1.22) brightness(1.03)",
  cool: "saturate(.92) hue-rotate(12deg) brightness(1.02)",
  vivid: "saturate(1.55) contrast(1.08)",
};
const FILTER_CANVAS: Record<EditSettings["filter"], string> = {
  none: "none",
  cinematic: "contrast(1.18) saturate(1.16) brightness(.96)",
  mono: "grayscale(1) contrast(1.08)",
  warm: "sepia(.22) saturate(1.22) brightness(1.03)",
  cool: "saturate(.92) hue-rotate(12deg) brightness(1.02)",
  vivid: "saturate(1.55) contrast(1.08)",
};

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00";
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function applyPromptToSettings(prompt: string, duration: number, current: EditSettings): { settings: EditSettings; actions: string[] } {
  const text = prompt.toLowerCase();
  let next = { ...current };
  const actions: string[] = [];
  const range = text.match(/(?:from|between)\s+(\d+(?:\.\d+)?)\s*(?:s|sec|seconds?)?\s+(?:to|and|-)\s+(\d+(?:\.\d+)?)\s*(?:s|sec|seconds?)?/i)
    ?? text.match(/trim\s+(\d+(?:\.\d+)?)\s*(?:s|sec|seconds?)?\s+to\s+(\d+(?:\.\d+)?)\s*(?:s|sec|seconds?)?/i);
  if (range) {
    const start = clamp(Number(range[1]), 0, Math.max(0, duration - 0.1));
    const end = clamp(Number(range[2]), start + 0.1, duration);
    next.start = start;
    next.end = end;
    actions.push(`Trim set to ${formatTime(start)}–${formatTime(end)}`);
  } else {
    const removeStart = text.match(/(?:remove|cut|trim)\s+(?:the\s+)?first\s+(\d+(?:\.\d+)?)\s*(?:s|sec|seconds?)/i);
    const removeEnd = text.match(/(?:remove|cut|trim)\s+(?:the\s+)?last\s+(\d+(?:\.\d+)?)\s*(?:s|sec|seconds?)/i);
    if (removeStart) {
      next.start = clamp(Number(removeStart[1]), 0, Math.max(0, duration - 0.1));
      actions.push(`First ${removeStart[1]} seconds removed`);
    }
    if (removeEnd) {
      const end = duration - Number(removeEnd[1]);
      next.end = clamp(end, next.start + 0.1, duration);
      actions.push(`Last ${removeEnd[1]} seconds removed`);
    }
  }

  const speed = text.match(/(?:speed|playback|make it)\s*(?:to\s*)?(0\.25|0\.5|0\.75|1\.25|1\.5|2|3|4)\s*x\b/i)
    ?? text.match(/\b(0\.25|0\.5|0\.75|1\.25|1\.5|2|3|4)\s*x\b/i);
  if (speed) {
    next.speed = Number(speed[1]);
    actions.push(`Speed set to ${next.speed}×`);
  } else if (/slow[- ]motion|slow it down|half speed/.test(text)) {
    next.speed = 0.5;
    actions.push("Slow motion set to 0.5×");
  } else if (/speed it up|fast[- ]forward|double speed/.test(text)) {
    next.speed = 2;
    actions.push("Speed set to 2×");
  }

  const filter: EditSettings["filter"] | null = /black and white|black & white|grayscale|greyscale|monochrome/.test(text) ? "mono"
    : /cinematic|movie look|film look/.test(text) ? "cinematic"
      : /warm|golden hour|sunset tone/.test(text) ? "warm"
        : /cool tone|blue tone|cold color/.test(text) ? "cool"
          : /vivid|more colorful|boost the colo(u)?rs/.test(text) ? "vivid"
            : /remove the filter|reset colo(u)?r|original colo(u)?r/.test(text) ? "none" : null;
  if (filter) {
    next.filter = filter;
    actions.push(`Color look set to ${filter === "none" ? "original" : filter}`);
  }
  if (/brighten|brighter|increase brightness/.test(text)) { next.brightness = 118; actions.push("Brightness increased"); }
  else if (/darken|darker|decrease brightness/.test(text)) { next.brightness = 82; actions.push("Brightness decreased"); }
  if (/increase contrast|more contrast|punchier contrast/.test(text)) { next.contrast = 120; actions.push("Contrast increased"); }
  else if (/reduce contrast|less contrast|softer contrast/.test(text)) { next.contrast = 85; actions.push("Contrast reduced"); }
  if (/boost saturation|more saturated|saturate the colo(u)?rs/.test(text)) { next.saturation = 130; actions.push("Color saturation increased"); }
  else if (/reduce saturation|less saturated|muted colo(u)?rs/.test(text)) { next.saturation = 75; actions.push("Color saturation reduced"); }

  if (/vertical|tiktok|reel|portrait video/.test(text)) {
    next.ratio = "9:16";
    actions.push("Framing set to vertical 9:16");
  } else if (/square video|1:1 aspect|square crop/.test(text)) {
    next.ratio = "1:1";
    actions.push("Framing set to square");
  } else if (/widescreen|landscape|16:9/.test(text)) {
    next.ratio = "16:9";
    actions.push("Framing set to widescreen 16:9");
  } else if (/source aspect|original framing/.test(text)) {
    next.ratio = "source";
    actions.push("Original framing restored");
  }

  const title = prompt.match(/(?:add|show|put)\s+(?:a\s+)?title\s*["“']([^"”']+)["”']/i);
  if (title) {
    next.title = title[1].trim().slice(0, 80);
    actions.push("Title overlay added");
  } else if (/remove title|no title overlay/.test(text)) {
    next.title = "";
    actions.push("Title overlay removed");
  }

  if (!actions.length) actions.push("I couldn’t find an edit instruction. Try “make it cinematic, trim from 2 to 9 seconds, and set it to 1.5x speed.”");
  return { settings: next, actions };
}

function parseGraphicTitle(prompt: string) {
  const quoted = prompt.match(/["“']([^"”']{2,80})["”']/);
  if (quoted) return quoted[1].trim();
  const clean = prompt.replace(/^(create|make|generate|design)\s+(?:a\s+)?(?:cinematic\s+)?(?:animated\s+)?(?:video|animation|motion graphic)?\s*(?:about|for|of)?\s*/i, "").trim();
  return (clean || prompt).slice(0, 72);
}

export default function VideoStudioPage() {
  const { user, accessToken, refreshSession, loading } = useAuth();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const generatedCanvasRef = useRef<HTMLCanvasElement>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [outputUrl, setOutputUrl] = useState("");
  const [duration, setDuration] = useState(0);
  const [settings, setSettings] = useState<EditSettings>(INITIAL_SETTINGS);
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<VideoStudioMode>("generate");
  const [graphicTitle, setGraphicTitle] = useState("");
  const [graphicDuration, setGraphicDuration] = useState(8);
  const [status, setStatus] = useState("");
  const [exporting, setExporting] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [paidGenerationConfirmed, setPaidGenerationConfirmed] = useState(false);
  const lastSettingsRef = useRef(settings);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (lastSettingsRef.current !== settings) setOutputUrl("");
    lastSettingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (!sourceFile) {
      setSourceUrl("");
      return;
    }
    const url = URL.createObjectURL(sourceFile);
    setSourceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [sourceFile]);

  useEffect(() => () => {
    if (outputUrl) URL.revokeObjectURL(outputUrl);
  }, [outputUrl]);

  useEffect(() => {
    const canvas = generatedCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !graphicTitle) return;
    let frame = 0;
    let animation = 0;
    const render = (timestamp: number) => {
      const t = timestamp / 1000;
      const width = canvas.width;
      const height = canvas.height;
      const ocean = /ocean|sea|water|blue|space|night/i.test(prompt);
      const warm = /sun|fire|warm|gold|desert|orange/i.test(prompt);
      const colorA = ocean ? "#061c36" : warm ? "#482516" : "#20134b";
      const colorB = ocean ? "#126c83" : warm ? "#b64d31" : "#8448cf";
      const gradient = context.createLinearGradient(width * (0.2 + Math.sin(t * 0.12) * 0.15), 0, width, height);
      gradient.addColorStop(0, colorA);
      gradient.addColorStop(0.52, colorB);
      gradient.addColorStop(1, "#090f20");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      context.globalAlpha = 0.18;
      for (let i = 0; i < 7; i++) {
        const x = width * (0.12 + i * 0.145) + Math.sin(t * 0.35 + i) * 38;
        const y = height * (0.2 + (i % 3) * 0.22) + Math.cos(t * 0.25 + i) * 22;
        const radius = 50 + (i % 3) * 24 + Math.sin(t + i) * 8;
        const glow = context.createRadialGradient(x, y, 0, x, y, radius);
        glow.addColorStop(0, i % 2 ? "#f0abfc" : "#67e8f9");
        glow.addColorStop(1, "transparent");
        context.fillStyle = glow;
        context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }
      context.globalAlpha = 1;
      const lift = Math.sin(t * 0.8) * 9;
      context.textAlign = "center";
      context.shadowColor = "#030712aa";
      context.shadowBlur = 24;
      context.fillStyle = "#f8fafc";
      context.font = "700 76px system-ui, sans-serif";
      const words = graphicTitle.split(/\s+/);
      const lines: string[] = [];
      let line = "";
      words.forEach((word) => {
        const candidate = line ? `${line} ${word}` : word;
        if (context.measureText(candidate).width > width * 0.78 && line) {
          lines.push(line);
          line = word;
        } else line = candidate;
      });
      if (line) lines.push(line);
      const lineHeight = 92;
      const centerY = height / 2 - ((lines.length - 1) * lineHeight) / 2 + lift;
      lines.forEach((text, index) => context.fillText(text, width / 2, centerY + index * lineHeight, width * 0.82));
      context.shadowBlur = 0;
      context.fillStyle = "#e2e8f0b8";
      context.font = "500 22px system-ui, sans-serif";
      context.fillText("A prompt-made motion graphic", width / 2, height - 65);
      context.fillStyle = "#c4b5fd";
      context.fillRect(width * 0.44, 72, width * 0.12, 3);
      frame++;
      animation = requestAnimationFrame(render);
    };
    animation = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animation);
  }, [graphicTitle, prompt]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = settings.speed;
  }, [settings.speed, sourceUrl]);

  const effectiveEnd = duration > 0 ? (settings.end > 0 ? Math.min(settings.end, duration) : duration) : 0;
  const editedLength = Math.max(0, effectiveEnd - settings.start);
  const previewStyle = useMemo(() => ({ filter: `${FILTER_CSS[settings.filter]} brightness(${settings.brightness}%) contrast(${settings.contrast}%) saturate(${settings.saturation}%)`, objectFit: settings.ratio === "source" ? "contain" as const : "cover" as const }), [settings.filter, settings.ratio, settings.brightness, settings.contrast, settings.saturation]);

  const setVideoFile = useCallback((file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      setStatus("Choose a video file such as MP4, WebM, or MOV.");
      return;
    }
    setSourceFile(file);
    setOutputUrl("");
    setSettings(INITIAL_SETTINGS);
    setDuration(0);
    setMode("clip");
    setStatus(`${file.name} is ready. Describe the edits you want.`);
  }, []);

  const chooseFile = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setVideoFile(event.target.files?.[0]);
    event.target.value = "";
  }, [setVideoFile]);

  const generateAiFootage = useCallback(async () => {
    if (!prompt.trim()) {
      setStatus("Describe the footage you want first.");
      return;
    }
    if (!paidGenerationConfirmed) {
      setStatus("Confirm the paid Gemini video-generation cost before continuing.");
      return;
    }
    setMode("generate");
    setOutputUrl("");
    setGeneratingVideo(true);
    setStatus("Sending your prompt to Gemini Omni Flash…");
    try {
      const job = await apiFetch<VideoJob>("/videos/generate", {
        method: "POST",
        accessToken,
        body: JSON.stringify({ prompt: prompt.trim(), aspect_ratio: settings.ratio === "9:16" ? "9:16" : "16:9" }),
      });
      let result = job;
      for (let attempt = 0; attempt < 180; attempt++) {
        if (result.status === "complete") break;
        if (result.status === "failed") throw new Error(result.message);
        setStatus(result.message || "Gemini is generating your footage. This can take a few minutes.");
        await new Promise((resolve) => window.setTimeout(resolve, 4000));
        result = await apiFetch<VideoJob>(`/videos/jobs/${job.id}`, { accessToken });
      }
      if (result.status !== "complete") throw new Error("Generation is taking longer than expected. Your clip may still be processing; check again shortly.");

      let token = accessToken ?? await refreshSession();
      let response = await fetch(`/api/v1/videos/jobs/${job.id}/file`, {
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (response.status === 401) {
        token = await refreshSession();
        response = await fetch(`/api/v1/videos/jobs/${job.id}/file`, {
          credentials: "include",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? body?.detail ?? "Could not download the generated footage.");
      }
      const videoBlob = await response.blob();
      setOutputUrl(URL.createObjectURL(videoBlob));
      setStatus("Your AI-generated footage is ready to preview and download as MP4.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Video generation failed. Check Gemini billing and try again.");
    } finally {
      setGeneratingVideo(false);
    }
  }, [prompt, paidGenerationConfirmed, settings.ratio, accessToken, refreshSession]);

  const applyPrompt = useCallback(() => {
    if (!prompt.trim()) {
      setStatus("Describe the video change you want first.");
      return;
    }
    if (mode === "generate") {
      void generateAiFootage();
      return;
    }
    if (mode === "graphic") {
      setGraphicTitle(parseGraphicTitle(prompt));
      setMode("graphic");
      setOutputUrl("");
      setStatus("Motion graphic ready to preview. Export it as a WebM video when you’re happy with it.");
      return;
    }
    if (!sourceFile) {
      setStatus("Choose a video clip to edit, or switch to Generate AI footage.");
      return;
    }
    const result = applyPromptToSettings(prompt, duration, settings);
    setSettings(result.settings);
    if (videoRef.current && result.settings.start > 0) videoRef.current.currentTime = result.settings.start;
    setOutputUrl("");
    setStatus(result.actions.join(" · "));
  }, [prompt, mode, sourceFile, duration, settings, generateAiFootage]);

  const onMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    setDuration(video.duration);
    setSettings((current) => ({ ...current, end: current.end === 0 ? video.duration : Math.min(current.end, video.duration) }));
  }, []);

  const exportClip = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !sourceUrl || editedLength <= 0) {
      setStatus("Load a video and choose a valid trim range before exporting.");
      return;
    }
    const captureVideo = video as HTMLVideoElement & { captureStream?: () => MediaStream; webkitCaptureStream?: () => MediaStream };
    const capture = captureVideo.captureStream ?? captureVideo.webkitCaptureStream;
    const canvas = document.createElement("canvas");
    const sourceWidth = video.videoWidth || 1280;
    const sourceHeight = video.videoHeight || 720;
    const ratio = settings.ratio === "16:9" ? 16 / 9 : settings.ratio === "9:16" ? 9 / 16 : settings.ratio === "1:1" ? 1 : sourceWidth / sourceHeight;
    const width = ratio >= 1 ? 1280 : Math.round(720 * ratio);
    const height = Math.round(width / ratio);
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context || typeof canvas.captureStream !== "function" || typeof MediaRecorder === "undefined") {
      setStatus("This browser cannot export edited video. Please use the latest Chrome or Edge.");
      return;
    }
    const outputStream = canvas.captureStream(30);
    let sourceStream: MediaStream | null = null;
    try { sourceStream = capture?.call(video) ?? null; } catch { sourceStream = null; }
    sourceStream?.getAudioTracks().forEach((track) => outputStream.addTrack(track));
    const mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
      .find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) {
      setStatus("This browser does not support WebM video export.");
      outputStream.getTracks().forEach((track) => track.stop());
      return;
    }
    const chunks: BlobPart[] = [];
    let recorder: MediaRecorder;
    try { recorder = new MediaRecorder(outputStream, { mimeType }); }
    catch { setStatus("Could not start the browser video encoder."); outputStream.getTracks().forEach((track) => track.stop()); return; }
    setExporting(true);
    setStatus("Exporting your edited clip in the browser… keep this tab open.");
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => {
      setExporting(false);
      setStatus("The browser stopped the export unexpectedly. Try a shorter clip.");
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      if (outputUrl) URL.revokeObjectURL(outputUrl);
      setOutputUrl(URL.createObjectURL(blob));
      setExporting(false);
      setPlaying(false);
      video.pause();
      video.playbackRate = 1;
      outputStream.getTracks().forEach((track) => track.stop());
      sourceStream?.getTracks().forEach((track) => track.stop());
      setStatus(`Export complete · ${(blob.size / (1024 * 1024)).toFixed(1)} MB · WebM`);
    };

    const seeked = new Promise<void>((resolve) => {
      if (Math.abs(video.currentTime - settings.start) < 0.04) resolve();
      else {
        video.addEventListener("seeked", () => resolve(), { once: true });
        video.currentTime = settings.start;
      }
    });
    try {
      await seeked;
      video.playbackRate = settings.speed;
      recorder.start(200);
      const draw = () => {
        if (recorder.state !== "recording") return;
        const scale = settings.ratio === "source" ? Math.min(width / sourceWidth, height / sourceHeight) : Math.max(width / sourceWidth, height / sourceHeight);
        const drawWidth = sourceWidth * scale;
        const drawHeight = sourceHeight * scale;
        context.save();
        context.filter = `${FILTER_CANVAS[settings.filter]} brightness(${settings.brightness}%) contrast(${settings.contrast}%) saturate(${settings.saturation}%)`;
        context.fillStyle = "#050914";
        context.fillRect(0, 0, width, height);
        context.drawImage(video, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
        context.restore();
        if (settings.filter === "cinematic") {
          const vignette = context.createRadialGradient(width / 2, height / 2, width * 0.2, width / 2, height / 2, width * 0.72);
          vignette.addColorStop(0, "transparent");
          vignette.addColorStop(1, "#0009");
          context.fillStyle = vignette;
          context.fillRect(0, 0, width, height);
        }
        if (settings.title) {
          const fontSize = Math.max(24, Math.round(width * 0.045));
          context.font = `700 ${fontSize}px system-ui, sans-serif`;
          context.textAlign = "center";
          context.shadowColor = "#000";
          context.shadowBlur = 10;
          context.fillStyle = "white";
          context.fillText(settings.title, width / 2, height * 0.83, width * 0.84);
          context.shadowBlur = 0;
        }
        if (video.currentTime >= effectiveEnd || video.ended) {
          video.pause();
          recorder.stop();
          return;
        }
        requestAnimationFrame(draw);
      };
      await video.play();
      draw();
    } catch {
      if (recorder.state !== "inactive") recorder.stop();
      else {
        setExporting(false);
        setStatus("Could not play this clip for export. Check the file format and try again.");
      }
    }
  }, [sourceUrl, editedLength, settings, effectiveEnd, outputUrl]);

  const exportGraphic = useCallback(() => {
    const canvas = generatedCanvasRef.current;
    if (!canvas || typeof canvas.captureStream !== "function" || typeof MediaRecorder === "undefined") {
      setStatus("This browser cannot export video. Please use the latest Chrome or Edge.");
      return;
    }
    const stream = canvas.captureStream(30);
    const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) { setStatus("This browser does not support WebM video export."); return; }
    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    setExporting(true);
    setStatus(`Recording your ${graphicDuration}-second motion graphic…`);
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      if (outputUrl) URL.revokeObjectURL(outputUrl);
      setOutputUrl(URL.createObjectURL(blob));
      stream.getTracks().forEach((track) => track.stop());
      setExporting(false);
      setStatus(`Motion graphic exported · ${(blob.size / (1024 * 1024)).toFixed(1)} MB · WebM`);
    };
    recorder.start(200);
    window.setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, graphicDuration * 1000);
  }, [graphicDuration, outputUrl]);

  const onVideoTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (video && video.currentTime >= effectiveEnd && !exporting && video.currentTime > settings.start) {
      video.pause();
      video.currentTime = settings.start;
      setPlaying(false);
    }
  }, [effectiveEnd, exporting, settings.start]);

  const outputDownload = outputUrl ? <a className="video-download" href={outputUrl} download={mode === "generate" ? "deep-reverse-ai-footage.mp4" : mode === "graphic" ? "deep-reverse-motion-graphic.webm" : "deep-reverse-edited-video.webm"}>↓ Download {mode === "generate" ? "MP4" : "WebM"}</a> : null;

  if (loading || !user) return <div className="workspace-page-loading"><strong>DEEP REVERSE</strong><span>Opening Video Studio…</span></div>;

  return (
    <main className="video-studio-page">
      <header className="video-studio-header">
        <button className="video-back-button" onClick={() => router.push("/chat")}>← Back to Chat</button>
        <div><span className="video-eyebrow">DEEP REVERSE · CREATIVE TOOLS</span><h1>Video Studio</h1><p>Describe your edit. Preview it here, then export your video.</p></div>
        <div className="video-header-mark">▶</div>
      </header>

      <div className="video-studio-layout">
        <section className="video-preview-column">
          <div className="video-preview-frame">
            {outputUrl ? <div className="video-output-stage"><video src={outputUrl} controls autoPlay playsInline /><button onClick={() => setOutputUrl("")}>← Back to edit</button></div> : mode === "graphic" && graphicTitle ? <canvas ref={generatedCanvasRef} width={1280} height={720} className="video-graphic-canvas" aria-label="Animated motion graphic preview" /> : sourceUrl ? (
              <div className={`video-aspect video-aspect-${settings.ratio.replace(":", "-")}`}>
                <video ref={videoRef} src={sourceUrl} controls={!exporting} playsInline preload="metadata" onLoadedMetadata={onMetadata} onTimeUpdate={onVideoTimeUpdate} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} style={previewStyle} />
                {settings.title && <div className="video-title-overlay">{settings.title}</div>}
              </div>
            ) : <button className="video-empty-drop" onClick={() => fileInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); setVideoFile(event.dataTransfer.files[0]); }}>
              <span>▶</span><strong>{mode === "generate" ? "Your generated footage will appear here" : mode === "graphic" ? "Describe an animated title scene" : "Drop a video or choose a file"}</strong><small>{mode === "generate" ? "Write a scene prompt and generate real AI video footage" : "MP4, WebM, MOV and other browser-supported formats"}</small>
              <span className="video-choose-button">{mode === "generate" ? "Or upload a clip to edit" : "Choose video"}</span>
            </button>}
            {mode === "graphic" && graphicTitle && outputUrl && <canvas ref={generatedCanvasRef} width={1280} height={720} className="video-render-source" aria-hidden="true" />}
          </div>
          <div className="video-preview-meta">
            <div><strong>{mode === "generate" && outputUrl ? "AI-generated footage" : mode === "graphic" && graphicTitle ? "Prompt motion graphic" : sourceFile?.name ?? "Your video preview"}</strong><span>{mode === "generate" && outputUrl ? "Gemini Omni Flash · MP4 video" : mode === "graphic" && graphicTitle ? `${graphicDuration} seconds · animated title scene` : sourceFile ? `${formatTime(duration)} · ${sourceFile.type || "video"}` : "Choose a clip or describe footage"}</span></div>
            {outputDownload}
          </div>

          {sourceUrl && duration > 0 && <div className="video-trim-panel">
            <div className="video-section-heading"><div><strong>Trim range</strong><span>{formatTime(settings.start)} – {formatTime(effectiveEnd)} · {formatTime(editedLength)} output</span></div><button onClick={() => { setSettings((value) => ({ ...value, start: 0, end: duration })); if (videoRef.current) videoRef.current.currentTime = 0; }}>Reset</button></div>
            <div className="video-range-row"><label>In <input aria-label="Trim start time" type="range" min="0" max={Math.max(0, duration - 0.1)} step="0.1" value={settings.start} onChange={(event) => setSettings((value) => ({ ...value, start: Math.min(Number(event.target.value), effectiveEnd - 0.1) }))} /></label><label>Out <input aria-label="Trim end time" type="range" min={Math.min(duration, settings.start + 0.1)} max={duration} step="0.1" value={effectiveEnd} onChange={(event) => setSettings((value) => ({ ...value, end: Number(event.target.value) }))} /></label></div>
          </div>}

          <div className="video-capability-note"><span>ⓘ</span><p>AI generation creates real video footage with Gemini. Prompt-based trim, speed, color, and framing changes on uploaded clips are processed locally in your browser.</p></div>
        </section>

        <section className="video-editor-column">
          <div className="video-mode-tabs"><button className={mode === "generate" ? "active" : ""} onClick={() => { setMode("generate"); setOutputUrl(""); }}>Generate footage</button><button className={mode === "clip" ? "active" : ""} onClick={() => { setMode("clip"); setOutputUrl(""); }}>Edit a video</button><button className={mode === "graphic" ? "active" : ""} onClick={() => { setMode("graphic"); setOutputUrl(""); if (!graphicTitle && prompt) setGraphicTitle(parseGraphicTitle(prompt)); }}>Title graphic</button></div>
          <div className="video-editor-content">
            <span className="video-editor-label">YOUR PROMPT</span>
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={mode === "generate" ? "A cinematic drone shot over misty mountains at sunrise, sweeping camera movement, soft golden light, orchestral score…" : mode === "clip" ? "Make it cinematic, trim from 2 to 9 seconds, slow motion, and add title ‘Summer’…" : "Create an animated title scene for ‘Midnight in Tokyo’…"} rows={4} />
            <div className="video-prompt-actions"><button className="video-apply-prompt" disabled={generatingVideo || (mode === "generate" && !paidGenerationConfirmed)} onClick={mode === "generate" ? generateAiFootage : applyPrompt}>{generatingVideo ? "Generating footage…" : mode === "generate" ? "Generate AI footage" : mode === "graphic" ? "Create motion graphic" : "Apply prompt to clip"} <span>↗</span></button><button className="video-upload-button" onClick={() => fileInput.current?.click()}>＋ Add video</button></div>

            {mode === "generate" && <>
              <div className="video-control-group"><strong>Video framing</strong><div className="video-choice-row">{(["16:9", "9:16"] as const).map((ratio) => <button key={ratio} className={settings.ratio === ratio ? "selected" : ""} onClick={() => setSettings((value) => ({ ...value, ratio }))}>{ratio === "16:9" ? "Landscape 16:9" : "Portrait 9:16"}</button>)}</div></div>
              <label className="video-paid-confirm"><input type="checkbox" checked={paidGenerationConfirmed} onChange={(event) => setPaidGenerationConfirmed(event.target.checked)} /><span><strong>Enable paid AI footage generation</strong><small>Gemini Omni Flash is paid-tier. Google’s listed 720p rate is about $0.10 per second of generated video; actual cost depends on output length.</small></span></label>
            </>}

            {mode === "clip" && sourceFile && <>
              <div className="video-control-group"><strong>Speed</strong><div className="video-choice-row">{[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => <button key={speed} className={settings.speed === speed ? "selected" : ""} onClick={() => setSettings((value) => ({ ...value, speed }))}>{speed}×</button>)}</div></div>
              <div className="video-control-group"><strong>Color look</strong><div className="video-choice-row">{(["none", "cinematic", "mono", "warm", "cool", "vivid"] as const).map((filter) => <button key={filter} className={settings.filter === filter ? "selected" : ""} onClick={() => setSettings((value) => ({ ...value, filter }))}>{filter === "none" ? "Original" : filter === "mono" ? "B&W" : filter[0].toUpperCase() + filter.slice(1)}</button>)}</div></div>
              <div className="video-control-group"><strong>Frame</strong><div className="video-choice-row">{(["source", "16:9", "9:16", "1:1"] as const).map((ratio) => <button key={ratio} className={settings.ratio === ratio ? "selected" : ""} onClick={() => setSettings((value) => ({ ...value, ratio }))}>{ratio === "source" ? "Original" : ratio}</button>)}</div></div>
              <div className="video-adjustments"><label>Brightness <input type="range" min="50" max="150" value={settings.brightness} onChange={(event) => setSettings((value) => ({ ...value, brightness: Number(event.target.value) }))} /><span>{settings.brightness}%</span></label><label>Contrast <input type="range" min="50" max="150" value={settings.contrast} onChange={(event) => setSettings((value) => ({ ...value, contrast: Number(event.target.value) }))} /><span>{settings.contrast}%</span></label><label>Saturation <input type="range" min="0" max="180" value={settings.saturation} onChange={(event) => setSettings((value) => ({ ...value, saturation: Number(event.target.value) }))} /><span>{settings.saturation}%</span></label></div>
            </>}

            {mode === "graphic" && <div className="video-control-group"><strong>Motion-graphic duration</strong><div className="video-choice-row">{[5, 8, 12].map((seconds) => <button key={seconds} className={graphicDuration === seconds ? "selected" : ""} onClick={() => setGraphicDuration(seconds)}>{seconds}s</button>)}</div><small className="video-help-text">Creates an animated title scene from your prompt. It doesn’t generate AI footage.</small></div>}

            {mode !== "generate" && <div className="video-export-card"><div><strong>{outputUrl ? "Your export is ready" : "Export video"}</strong><span>{mode === "graphic" ? `${graphicDuration}s motion graphic · WebM` : `${formatTime(editedLength || duration)} · ${settings.speed}× · WebM`}</span></div><button disabled={exporting || (mode === "clip" && !sourceFile) || (mode === "graphic" && !graphicTitle)} onClick={mode === "graphic" ? exportGraphic : exportClip}>{exporting ? "Exporting…" : outputUrl ? "Export again" : "Export WebM"}</button></div>}
            {status && <div className="video-status" role="status">{status}</div>}
            <div className="video-examples"><span>Try a prompt</span><button onClick={() => setPrompt("Make it cinematic, trim from 2 to 12 seconds, and slow motion")}>Cinematic trim · 0.5× example</button><button onClick={() => setPrompt("Make a vertical 9:16 reel, boost the colors, and set speed to 1.5x")}>Vertical colorful reel · 1.5× example</button><button onClick={() => { setPrompt("Create a cinematic animated title for ‘Midnight in Tokyo’"); setGraphicTitle("Midnight in Tokyo"); setMode("graphic"); }}>Create a motion title card</button></div>
          </div>
        </section>
      </div>
      <input ref={fileInput} type="file" accept="video/*" onChange={chooseFile} hidden />
      <footer className="video-studio-footer"><span><i /> Runs locally in this browser</span><span>DEEP REVERSE · Video Studio</span></footer>
    </main>
  );
}
