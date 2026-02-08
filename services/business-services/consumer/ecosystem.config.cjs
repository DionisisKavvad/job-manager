module.exports = {
  apps: [{
    name: 'sqs-worker',
    script: 'src/worker/sqs-worker.cjs',
    instances: 3,
    exec_mode: 'cluster',
    max_memory_restart: '1G',
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 5000,
    kill_timeout: 5000,
    cron_restart: '0 2 * * *',
    error_file: '.output/logs/err.log',
    out_file: '.output/logs/out.log',
    merge_logs: true,
    env: {
      NODE_ENV: 'dev',
    },
    env_production: {
      NODE_ENV: 'production',
    },
  }],
};
