/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // In dev, proxy /api/* straight to the FastAPI service so the browser
    // only ever talks to one origin (avoids CORS entirely for local work).
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_INTERNAL_URL || "http://api:8000"}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
