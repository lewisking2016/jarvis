import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone", // VPS deploy: self-contained bundle, no npm install on the server
  serverExternalPackages: ["pdfkit", "@google/genai", "@modelcontextprotocol/sdk", "msedge-tts"],
};

export default nextConfig;
