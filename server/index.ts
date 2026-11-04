import { createServer, type ServerResponse } from 'node:http';
import { simulateRecovery } from '../src/utils/diagnosis';
import { createMongoClient, databaseName, journeysCollection } from './db';

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

function getPort() {
  const port = Number(process.env.API_PORT ?? '3001');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('API_PORT must be an integer between 1 and 65535.');
  }
  return port;
}

async function startApi() {
  const client = createMongoClient();
  try {
    await client.connect();
    const database = client.db(databaseName);
    await database.command({ ping: 1 });
    const journeys = journeysCollection(client);
    const port = getPort();

    const server = createServer((request, response) => {
      void (async () => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (url.pathname === '/api/health') {
          if (request.method !== 'GET') {
            sendJson(response, 405, { error: 'Method not allowed.' });
            return;
          }
          await database.command({ ping: 1 });
          sendJson(response, 200, { status: 'ok', database: databaseName });
          return;
        }

        if (url.pathname === '/api/journeys') {
          if (request.method !== 'GET') {
            sendJson(response, 405, { error: 'Method not allowed.' });
            return;
          }
          const records = await journeys.find({}, { projection: { _id: 0 } })
            .sort({ dispatchTimestamp: -1 })
            .toArray();
          sendJson(response, 200, records);
          return;
        }

        const recoveryMatch = /^\/api\/journeys\/([^/]+)\/recovery$/.exec(url.pathname);
        if (recoveryMatch) {
          if (request.method !== 'POST') {
            sendJson(response, 405, { error: 'Method not allowed.' });
            return;
          }
          let asnId: string;
          try {
            asnId = decodeURIComponent(recoveryMatch[1]);
          } catch {
            sendJson(response, 400, { error: 'ASN ID is not valid URL encoding.' });
            return;
          }
          const document = await journeys.findOne({ asnId });
          if (!document) {
            sendJson(response, 404, { error: `ASN ${asnId} was not found.` });
            return;
          }
          const { _id, ...journey } = document;
          let updated;
          try {
            updated = simulateRecovery(journey);
          } catch (error) {
            sendJson(response, 409, {
              error: error instanceof Error ? error.message : 'Recovery simulation failed.',
            });
            return;
          }
          await journeys.replaceOne({ _id }, updated);
          sendJson(response, 200, updated);
          return;
        }

        sendJson(response, 404, { error: 'API route not found.' });
      })().catch((error: unknown) => {
        console.error('API request failed:', error);
        if (!response.headersSent) sendJson(response, 500, { error: 'The API could not complete the request.' });
        else response.destroy();
      });
    });

    server.listen(port, '127.0.0.1', () => {
      console.info(`ASN360 API listening on http://127.0.0.1:${port}; MongoDB database "${databaseName}" is connected.`);
    });

    const shutdown = () => {
      server.close(() => {
        void client.close();
      });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (error) {
    await client.close();
    throw error;
  }
}

void startApi().catch((error: unknown) => {
  console.error('Could not start the ASN360 API. Confirm MongoDB is running and MONGODB_URI is correct.', error);
  process.exitCode = 1;
});
