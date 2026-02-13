/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '250m',
    },
  },
};

module.exports = nextConfig;
