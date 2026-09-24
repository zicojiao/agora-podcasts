import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  allowedDevOrigins: ['127.0.0.1'],
  // Keep the Node SDK and its WebSocket dependency outside the server bundle; the browser
  // Live client is bundled separately through the package's browser export.
  serverExternalPackages: ['@google/genai', 'ws'],
  images: { unoptimized: true },
  turbopack: { root: rootDir },
};

export default nextConfig;
