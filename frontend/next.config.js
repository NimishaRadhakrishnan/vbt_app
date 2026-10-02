/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // SAMEORIGIN (not DENY): still fully blocks the actual threat
          // this header exists for - an external, malicious site
          // embedding this app in an iframe for clickjacking - while
          // allowing the app to embed ITSELF, which the phone preview
          // simulator (components/PhoneSimulator.tsx) needs to render
          // the current page inside its device frame. Cross-origin
          // framing is still fully denied either way.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
