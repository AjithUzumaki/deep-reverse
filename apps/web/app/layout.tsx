import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DEEP REVERSE",
  description: "A multimodal AI assistant platform.",
  icons: { icon: "data:," }, // real favicon lands with the design system
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
