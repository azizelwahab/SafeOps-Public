import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { notFound, handleError } from './middleware/errors.js';
import { apiBasePath, createApiRouter } from './routes/apiRoutes.js';
import { createReadinessCheck } from './services/readinessService.js';

// Importing the app leaves port binding to the server entry point.
export function createApp({ probeDatabase } = {}) {
  const app = express();

  app.use(helmet());
  if (env.nodeEnv !== 'test') {
    // Route templates retain diagnostics without logging client-controlled URLs or headers.
    app.use(morgan((tokens, req, res) => [
      tokens.method(req, res),
      req.route?.path ?? '[unmatched]',
      tokens.status(req, res),
      tokens['response-time'](req, res),
      'ms',
    ].join(' ')));
  }
  app.use(cors({ origin: env.corsOrigins }));
  app.get('/', (_req, res) => res.redirect(302, '/app/'));
  app.use(apiBasePath, createApiRouter(createReadinessCheck(probeDatabase)));
  app.use('/app', express.static(fileURLToPath(new URL('../web/', import.meta.url))));
  app.use(notFound);
  app.use(handleError);
  return app;
}

export default createApp();
