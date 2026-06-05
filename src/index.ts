import 'dotenv/config';
import express from 'express';
import { config } from './config/contracts.js';
import positionsRouter from './routes/positions.js';

const app = express();

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/positions', positionsRouter);

app.listen(config.port, () => {
  console.info(`[server] listening on port ${config.port}`);
});
