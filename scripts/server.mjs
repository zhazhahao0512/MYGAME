import { createServer, preview } from 'vite';

// Shared launcher for development and browser verification. Vite reads PORT from its config.
const production = process.argv.includes('--preview');
const server = production ? await preview() : await createServer();
if (!production) await server.listen();
server.printUrls();

async function stop() {
  if ('close' in server) await server.close();
  else await new Promise(resolve => server.httpServer.close(resolve));
  process.exit(0);
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
