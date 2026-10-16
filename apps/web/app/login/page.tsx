"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/api";
import { authFormStyles as s } from "@/lib/auth-form-styles";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      router.push("/chat");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={s.main}>
      <h1 style={s.heading}>Log in to DEEP REVERSE</h1>
      <form onSubmit={handleSubmit} style={s.form}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={s.input}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={s.input}
        />
        {error && <p style={s.error}>{error}</p>}
        <button type="submit" disabled={submitting} style={s.button}>
          {submitting ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p style={s.footer}>
        No account? <a href="/register">Register</a>
      </p>
    </main>
  );
}
