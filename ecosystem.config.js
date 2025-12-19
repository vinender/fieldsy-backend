module.exports = {
  apps: [
    {
      name: 'fieldsy-api',
      script: 'dist/server.js',

      // Cluster mode - run multiple instances for high availability
      // If one crashes, others keep serving traffic
      instances: 'max', // Use all available CPU cores (or set to 2, 4, etc.)
      exec_mode: 'cluster',

      // Auto-restart configuration
      autorestart: true,
      watch: false, // Don't watch files in production
      max_memory_restart: '1G', // Restart if memory exceeds 1GB

      // Restart settings
      max_restarts: 10, // Max restarts within min_uptime window
      min_uptime: '10s', // Consider app crashed if it exits before 10s
      restart_delay: 4000, // Wait 4 seconds before restarting

      // Exponential backoff restart delay
      exp_backoff_restart_delay: 100, // Start with 100ms, doubles each restart

      // Environment variables
      env: {
        NODE_ENV: 'development',
        PORT: 5000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 5000
      },

      // Logging
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // Graceful shutdown
      kill_timeout: 5000, // Time to wait before force kill
      wait_ready: true, // Wait for process.send('ready')
      listen_timeout: 10000, // Time to wait for app to listen
    }
  ]
};
