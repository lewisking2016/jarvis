import type { NextConfig } from "next";

/**
 * SPLIT ARCHITECTURE — frontend on Vercel, brain (API + MCP + OmniRoute) on the VPS.
 *
 * When NEXT_PUBLIC_BACKEND_URL is set (Vercel builds), every /api/* request is
 * proxied server-side to the VPS via a beforeFiles rewrite. The browser only
 * ever talks same-origin to Vercel — so no mixed-content blocks, no CORS, and
 * the VPS never needs a public TLS cert. Server-to-server HTTP over the public
 * internet; upgrade path later is nginx + Cloudflare in front of the VPS.
 *
 * Locally (no env) everything stays same-origin as before.
 */
const BACKEND = (process.env.NEXT_PUBLIC_BACKEND_URL ?? "").replace(/\/$/, "");

const nextConfig: NextConfig = {
  output: "standalone", // VPS deploy: self-contained bundle, no npm install on the server
  serverExternalPackages: ["pdfkit", "@google/genai", "@modelcontextprotocol/sdk", "msedge-tts"],
  ...(BACKEND
    ? {
        async rewrites() {
          return {
            beforeFiles: [
              { source: "/api/:path*", destination: `${BACKEND}/api/:path*` },
            ],
            afterFiles: [],
            fallback: [],
          };
        },
      }
    : {}),
};

export default nextConfig;
