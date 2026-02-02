/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@savorg/core', '@savorg/ui', '@savorg/adapters-openclaw'],
  typedRoutes: true,
}

module.exports = nextConfig
