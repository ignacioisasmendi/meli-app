/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // Product pictures come straight from ML's CDN. Most land on http2, but
    // older listings serve from per-site hosts (mla-s1-p, mla-s2-p, …), so the
    // whole domain is allowed rather than one host.
    remotePatterns: [
      { protocol: 'https', hostname: '**.mlstatic.com' },
    ],
  },
}

export default nextConfig
