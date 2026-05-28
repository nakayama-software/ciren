module.exports = {
  apps: [
    {
      name: 'ciren-backend',
      script: 'backend/src/index.js',
      cwd: './',

      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',

      env: {
        NODE_ENV: 'production',
      },

      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: 'logs/ciren-error.log',
      out_file: 'logs/ciren-out.log',
      merge_logs: true,
    },
    {
      name: 'ciren-frontend',
      script: 'node_modules/vite/bin/vite.js',
      cwd: './frontend',

      autorestart: true,
      watch: false,

      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: 'logs/ciren-frontend-error.log',
      out_file: 'logs/ciren-frontend-out.log',
      merge_logs: true,
    },
  ],
}
