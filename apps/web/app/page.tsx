"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type HealthStatus = "checking" | "ok" | "error";

export default function Home() {
  const { user, loading } = useAuth();
  const [apiStatus, setApiStatus] = useState<HealthStatus>("checking");
  const [dbStatus, setDbStatus] = useState<HealthStatus>("checking");

  useEffect(() => {
    apiFetch("/health")
      .then(() => setApiStatus("ok"))
      .catch(() => setApiStatus("error"));

    apiFetch("/health/db")
      .then(() => setDbStatus("ok"))
      .catch((e) => {
        // A DB error still means the API itself is reachable —
        // surfaced separately so a failed migration is obvious.
        if (e instanceof ApiError) setDbStatus("error");
      });
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>DEEP REVERSE</h1>
      <p style={{ color: "#666", marginBottom: "2rem" }}>Phase 0 scaffold — wiring check.</p>

      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.5rem 1rem" }}>
        <dt>API</dt>
        <dd>{renderStatus(apiStatus)}</dd>
        <dt>Database</dt>
        <dd>{renderStatus(dbStatus)}</dd>
      </dl>

      <p style={{ marginTop: "2rem", fontSize: "0.875rem" }}>
        {!loading && (user ? (
          <a href="/chat">Go to chat →</a>
        ) : (
          <>
            <a href="/login">Log in</a> or <a href="/register">create an account</a> to start chatting.
          </>
        ))}
      </p>
    </main>
  );
}

function renderStatus(status: HealthStatus) {
  const color = status === "ok" ? "#16a34a" : status === "error" ? "#dc2626" : "#999";
  const label = status === "ok" ? "connected" : status === "error" ? "unreachable" : "checking…";
  return <span style={{ color }}>{label}</span>;
}
