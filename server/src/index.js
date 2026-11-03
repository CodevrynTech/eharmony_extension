import 'dotenv/config';
import { loadConfig, ConfigError } from './config.js';
import { createGenerator } from './gemini.js';
import { createApp } from './app.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`Configuration error: ${err.message}\nLocally: copy .env.example to .env and fill it in. On Render: set the environment variables.`);
    process.exit(1);
  }
  throw err;
}

// Profile text is personal data: log metadata only, never content or tokens.
const log = (msg, meta = {}) => console.log(`${new Date().toISOString()} ${msg} ${JSON.stringify(meta)}`);

const app = createApp({ config, generate: createGenerator(config), log });
const server = app.listen(config.port, config.host, () => {
  log('server listening', {
    host: config.host, port: config.port, publicMode: config.publicMode, model: config.model,
    licenses: config.licenses.map((l) => `${l.label}(${l.dailyLimit}/day)`),
  });
});
server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${config.port} is already in use. Change PORT.` : err.message);
  process.exit(1);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
