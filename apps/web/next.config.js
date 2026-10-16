/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allows a second local dev server to use its own cache and route manifest.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async rewrites() {
    // In dev, proxy /api/* straight to the FastAPI service so the browser
    // only ever talks to one origin (avoids CORS entirely for local work).
    const apiUrl = process.env.API_INTERNAL_URL || "http://127.0.0.1:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
