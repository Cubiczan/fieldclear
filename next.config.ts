import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@aws-sdk/client-bedrock-runtime",
    "@vercel/oidc",
    "@vercel/oidc-aws-credentials-provider",
  ],
};

export default nextConfig;
