module.exports = {
  apps: [
    {
      name: "burrito-eerc",
      cwd: "/var/www/burrito-eerc",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3033",
      env: {
        NODE_ENV: "production",
        PORT: "3033",
        NEXT_PUBLIC_AVAX_RPC: process.env.NEXT_PUBLIC_AVAX_RPC || "https://api.avax.network/ext/bc/C/rpc",
        NEXT_PUBLIC_WC_PROJECT_ID: process.env.NEXT_PUBLIC_WC_PROJECT_ID || "demo"
      },
      instances: 1,             // puedes poner "max" si quieres cluster
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
    }
  ]
}
