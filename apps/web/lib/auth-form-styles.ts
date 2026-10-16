import type { CSSProperties } from "react";

export const authFormStyles = {
  main: {
    maxWidth: 360,
    margin: "4rem auto",
    fontFamily: "system-ui, sans-serif",
    padding: "0 1rem",
  } satisfies CSSProperties,
  heading: {
    fontSize: "1.25rem",
    marginBottom: "1.5rem",
  } satisfies CSSProperties,
  form: {
    display: "grid",
    gap: "0.75rem",
  } satisfies CSSProperties,
  input: {
    padding: "0.5rem 0.75rem",
    border: "1px solid #ccc",
    borderRadius: 6,
    fontSize: "1rem",
  } satisfies CSSProperties,
  button: {
    padding: "0.5rem 0.75rem",
    borderRadius: 6,
    border: "none",
    background: "#111",
    color: "#fff",
    cursor: "pointer",
    fontSize: "1rem",
  } satisfies CSSProperties,
  error: {
    color: "#dc2626",
    fontSize: "0.875rem",
  } satisfies CSSProperties,
  footer: {
    marginTop: "1rem",
    fontSize: "0.875rem",
  } satisfies CSSProperties,
};
