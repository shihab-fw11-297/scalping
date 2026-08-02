/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  typescript: {
    tsconfigPath: "tsconfig.build.json",
  },
};

export default nextConfig;
