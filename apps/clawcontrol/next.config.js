/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@clawcontrol/core', '@clawcontrol/ui', '@clawcontrol/adapters-openclaw'],
  typedRoutes: true,

  // Avoid bundling native Node deps into the server build.
  // In particular, `ws` can end up with a broken bufferutil shim when bundled.
  serverExternalPackages: ['ws'],

  // Security: clawcontrol is local-only.
  // Limit dev-origin allowances to loopback.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],

  // Note: instrumentationHook is now enabled by default in Next.js 16.1+
  // No need for experimental flag - instrumentation.ts is picked up automatically
}

module.exports = nextConfig
