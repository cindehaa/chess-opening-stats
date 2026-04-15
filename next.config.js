/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  // stockfish.js is a browser-only WASM package — skip SSR bundling entirely
  serverExternalPackages: ['stockfish.js'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
  // Empty turbopack config silences the "webpack config present but no turbopack config" error.
  // serverExternalPackages already handles stockfish.js server-side, and Turbopack
  // stubs Node built-ins (fs/path/os) in browser bundles automatically.
  turbopack: {},
  webpack(config, { isServer }) {
    if (isServer) {
      // stockfish.js is browser-only — don't bundle it for the server
      const existing = Array.isArray(config.externals) ? config.externals : []
      config.externals = [...existing, 'stockfish.js']
    } else {
      // Node built-ins used by stockfish are not available in the browser
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        fs: false,
        path: false,
        os: false,
      }
    }
    return config
  },
}

module.exports = nextConfig
