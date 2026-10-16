"use client";

import { useState } from "react";
import type { WebsiteArtifact } from "@/lib/website-preview";

export default function SitePreview({ artifact, onClose }: { artifact: WebsiteArtifact | null; onClose: () => void }) {
  const [view, setView] = useState<"preview" | "code">("preview");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <aside className="site-preview-panel" aria-label="Website preview">
      <div className="site-preview-toolbar">
        <div className="site-preview-heading">
          <span className="preview-live-dot" />
          <div>
            <strong>Website preview</strong>
            <span>{artifact ? "Generated from the latest response" : "Ready when you are"}</span>
          </div>
        </div>
        <div className="preview-toolbar-actions">
          {artifact && view === "preview" && (
            <div className="preview-device-switch" aria-label="Preview size">
              <button className={device === "desktop" ? "selected" : ""} onClick={() => setDevice("desktop")} title="Desktop width" aria-label="Desktop width">▰</button>
              <button className={device === "mobile" ? "selected" : ""} onClick={() => setDevice("mobile")} title="Mobile width" aria-label="Mobile width">▯</button>
            </div>
          )}
          <button className="preview-icon-button" onClick={() => setRefreshKey((key) => key + 1)} disabled={!artifact} title="Refresh preview" aria-label="Refresh preview">↻</button>
          <button className="preview-close-button" onClick={onClose} title="Close preview" aria-label="Close website preview">
            <span aria-hidden="true">×</span> Close
          </button>
        </div>
      </div>

      <div className="site-preview-tabs" role="tablist" aria-label="Website output">
        <button role="tab" aria-selected={view === "preview"} className={view === "preview" ? "active" : ""} onClick={() => setView("preview")}>
          <span>◉</span> Preview
        </button>
        <button role="tab" aria-selected={view === "code"} className={view === "code" ? "active" : ""} onClick={() => setView("code")}>
          <span>{"</>"}</span> Code
        </button>
        {artifact && (
          <a className="preview-download" href={`data:text/html;charset=utf-8,${encodeURIComponent(artifact.html)}`} download="deep-reverse-site.html" title="Download website HTML">
            ↓ <span>Export</span>
          </a>
        )}
      </div>

      <div className={`site-preview-content ${view === "code" ? "code-view" : ""}`}>
        {!artifact ? (
          <div className="preview-empty-state">
            <div className="preview-empty-icon">⌘</div>
            <h2>Your website will appear here</h2>
            <p>Ask DEEP REVERSE to build a website. You can refine it in the chat and preview each version here.</p>
            <div className="preview-empty-hint"><span>✦</span> Try “Create a modern portfolio website”</div>
          </div>
        ) : view === "preview" ? (
          <div className={`preview-browser-frame ${device === "mobile" ? "mobile-frame" : ""}`}>
            <div className="preview-browser-chrome">
              <div className="browser-dots"><i /><i /><i /></div>
              <div className="browser-address"><span>⌑</span> generated-site.local</div>
              <span className="browser-menu">•••</span>
            </div>
            <iframe
              key={`${refreshKey}-${artifact.html}`}
              title="Generated website"
              srcDoc={artifact.html}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
            />
          </div>
        ) : (
          <pre className="preview-source"><code>{artifact.html}</code></pre>
        )}
      </div>

      <div className="site-preview-footer">
        <span><i /> Isolated browser preview</span>
        <span>DEEP REVERSE Studio</span>
      </div>
    </aside>
  );
}
