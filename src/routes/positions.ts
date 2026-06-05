import { Router, type Request, type Response } from 'express';
import { isAddress } from 'viem';
import { FluidService } from '../services/FluidService.js';

const router = Router();
const fluidService = new FluidService();

function resolveAddress(req: Request): string | null {
  if (req.method === 'GET') return req.query.address as string | undefined ?? null;
  if (req.method === 'POST') return (req.body as { address?: string }).address ?? null;
  return null;
}

async function handlePositions(req: Request, res: Response): Promise<void> {
  const raw = resolveAddress(req);

  if (!raw || !isAddress(raw)) {
    res.status(400).json({ error: 'invalid_address', message: 'address must be a valid EVM address' });
    return;
  }

  try {
    const data = await fluidService.getPositions(raw);
    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[positions] error:', message);

    if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
      res.status(500).json({ error: 'rpc_timeout', message: 'Base RPC did not respond within 10s', retryAfter: 30 });
      return;
    }
    if (message.includes('429')) {
      res.status(500).json({ error: 'rpc_rate_limit', message: 'RPC rate limit exceeded', retryAfter: 60 });
      return;
    }
    res.status(500).json({ error: 'rpc_error', message: 'Internal error reading chain data' });
  }
}

router.get('/', handlePositions);
router.post('/', handlePositions);

export default router;
