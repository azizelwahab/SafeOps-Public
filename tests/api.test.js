import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import express from 'express';
import request from 'supertest';
import app from '../src/app.js';
import { handleError } from '../src/middleware/errors.js';
import packageMetadata from '../package.json' with { type: 'json' };

describe('SafeOps API', () => {
  test('returns application health with an ISO timestamp', async () => {
    const { body } = await request(app)
      .get('/api/v1/health')
      .expect('Content-Type', /application\/json/)
      .expect(200);

    assert.equal(typeof body.data.timestamp, 'string');
    assert.deepEqual(body, {
      success: true,
      data: {
        application: 'SafeOps',
        version: packageMetadata.version,
        status: 'ok',
        timestamp: body.data.timestamp,
      },
    });
    assert.equal(new Date(body.data.timestamp).toISOString(), body.data.timestamp);
  });

  test('returns API information and links to a working health endpoint', async () => {
    const { body } = await request(app)
      .get('/api/v1')
      .expect('Content-Type', /application\/json/)
      .expect(200);

    assert.deepEqual(body, {
      success: true,
      data: {
        application: 'SafeOps',
        version: packageMetadata.version,
        healthEndpoint: '/api/v1/health',
      },
    });
    await request(app).get(body.data.healthEndpoint).expect(200);
  });

  for (const path of ['/api/v1/unknown', '/unknown']) {
    test(`returns the 404 envelope for ${path}`, async () => {
      const { body } = await request(app)
        .get(path)
        .expect('Content-Type', /application\/json/)
        .expect(404);

      assert.deepEqual(body, {
        success: false,
        error: { code: 'NOT_FOUND', message: 'The requested route was not found.' },
      });
    });
  }

  test('uses a consistent error envelope and keeps exception details private', async () => {
    const errorApp = express();
    errorApp.get('/error', () => {
      throw new Error('Internal exception details');
    });
    errorApp.use(handleError);

    const { body } = await request(errorApp)
      .get('/error')
      .expect('Content-Type', /application\/json/)
      .expect(500);

    assert.deepEqual(body, {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
      },
    });
  });
});
