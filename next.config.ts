import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@monaco-editor/react'],
  serverExternalPackages: ['@composio/core', '@truefoundry/trueforge-sdk', '@daytona/sdk', '@modelcontextprotocol/sdk'],
};

export default nextConfig;
