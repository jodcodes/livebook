import type { NextConfig } from "next";

const backendUrl = process.env.LIVEBOOK_BACKEND_URL ?? "http://127.0.0.1:3020";

const nextConfig: NextConfig = {
    async rewrites() {
        return [
            {
                source: "/api/backend/:path*",
                destination: `${backendUrl}/:path*`,
            },
            {
                source: "/api/question",
                destination: `${backendUrl}/question`,
            },
        ];
    },
    devIndicators: false,
};

export default nextConfig;
