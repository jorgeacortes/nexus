/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 is native; keep it server-external
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
