import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, get } from 'node:http';
import { once } from 'node:events';
import { createShutdown } from '../src/utils/shutdown.js';

test('shutdown refuses new connections and lets an active request finish before disconnecting', async () => {
  const received = Promise.withResolvers();
  const disconnected = Promise.withResolvers();
  const server = createServer((_req, res) => received.resolve(res));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;

  let disconnectStarted = false;
  const shutdown = createShutdown(server, async () => {
    disconnectStarted = true;
    disconnected.resolve();
  });
  const active = new Promise((resolve, reject) => {
    get(url, { agent: false }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
      response.on('error', reject);
    }).on('error', reject);
  });

  const response = await received.promise;
  try {
    shutdown('SIGINT');
    const newConnection = get(url, { agent: false });
    const [error] = await once(newConnection, 'error');
    assert.equal(error.code, 'ECONNREFUSED');
    assert.equal(disconnectStarted, false);
  } finally {
    response.end('done');
  }
  assert.equal(await active, 200);
  await disconnected.promise;
});

test('shutdown enforces its deadline when database disconnection stalls', async () => {
  const disconnected = Promise.withResolvers();
  const forcedExit = Promise.withResolvers();
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const shutdown = createShutdown(server, () => disconnected.promise, {
    timeoutMs: 50,
    exit: forcedExit.resolve,
  });

  try {
    shutdown('SIGTERM');
    assert.equal(await forcedExit.promise, 1);
  } finally {
    disconnected.resolve();
  }
});
