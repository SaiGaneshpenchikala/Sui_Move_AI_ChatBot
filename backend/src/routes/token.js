// routes/token.js
import { Router } from 'express';
import { z } from 'zod';
import { mintTokens } from '../sui.js';

export const tokenRouter = Router();

const MintSchema = z.object({
  pointsAccountObjectId: z.string(),
  tokenAmount: z.number().int().min(1).max(1000),
});

// POST /api/token/mint — burn points and mint AURA tokens
tokenRouter.post('/mint', async (req, res) => {
  try {
    const parsed = MintSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const { pointsAccountObjectId, tokenAmount } = parsed.data;
    const pointsRequired = tokenAmount * 100;

    const result = await mintTokens({
      mintCapObjectId: process.env.MINT_CAP_OBJECT_ID,
      treasuryCapObjectId: process.env.TREASURY_CAP_OBJECT_ID,
      tokenConfigObjectId: process.env.TOKEN_CONFIG_OBJECT_ID,
      pointsAccountObjectId,
      tokenAmount,
    });

    const digest = result.digest;
    res.json({
      success: true,
      tokenAmount,
      pointsBurned: pointsRequired,
      transactionDigest: digest,
    });
  } catch (err) {
    console.error('[Token] mint error:', err.message);
    if (err.message?.includes('EInsufficientPoints')) {
      return res.status(400).json({ error: 'Insufficient points' });
    }
    if (err.message?.includes('EMaxSupplyExceeded')) {
      return res.status(400).json({ error: 'Maximum token supply reached' });
    }
    res.status(500).json({ error: 'Minting failed' });
  }
});
