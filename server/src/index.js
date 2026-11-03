import 'dotenv/config';
import { loadConfig, ConfigError } from './config.js';
import { createGenerator } from './gemini.js';
import { createApp } from './app.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`Configuration error: ${err.message}\nCopy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  throw err;
}

// Profile text is personal data: log metadata only, never content.
const log = (msg, meta = {}) => console.log(`${new Date().toISOString()} ${msg} ${JSON.stringify(meta)}`);

const app = createApp({ config, generate: createGenerator(config), log });
const server = app.listen(config.port, '127.0.0.1', () => {
  log('server listening', { url: `http://127.0.0.1:${config.port}`, model: config.model });
});
server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${config.port} is already in use. Change PORT in .env.` : err.message);
  process.exit(1);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
