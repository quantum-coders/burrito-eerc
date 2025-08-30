/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,

  // Webpack configuration
  webpack: (config, { isServer, webpack }) => {
    // Handle node: protocol
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /^node:/,
        (resource) => {
          resource.request = resource.request.replace(/^node:/, '');
        }
      )
    );

    // Polyfills and fallbacks for client-side
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: require.resolve('crypto-browserify'),
        stream: require.resolve('stream-browserify'),
        buffer: require.resolve('buffer'),
        process: require.resolve('process/browser'),
        fs: false,
        net: false,
        tls: false,
        child_process: false,
        readline: false,
        zlib: false,
        http: false,
        https: false,
        os: false,
        path: false,
        util: false,
      };

      // Provide plugin for process and Buffer
      config.plugins.push(
        new webpack.ProvidePlugin({
          Buffer: ['buffer', 'Buffer'],
          process: 'process/browser',
        })
      );
    }

    // Handle .wasm files
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/resource',
    });

    // Ignore specific modules that cause issues
    config.resolve.alias = {
      ...config.resolve.alias,
      '@avalabs/eerc-sdk': isServer ? false : '@avalabs/eerc-sdk',
    };

    return config;
  },

  // Transpile packages if needed
  transpilePackages: ['@avalabs/eerc-sdk'],

  // Headers for CORS
  async headers() {
    return [
      {
        source: '/eerc/:path*',
        headers: [
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
        ],
      },
    ];
  },

  // Environment variables
  env: {
    NEXT_PUBLIC_AVAX_RPC: process.env.NEXT_PUBLIC_AVAX_RPC || 'https://api.avax.network/ext/bc/C/rpc',
  },
};

module.exports = nextConfig;
