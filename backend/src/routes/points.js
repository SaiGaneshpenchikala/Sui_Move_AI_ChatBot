// routes/points.js
import { Router } from 'express';
import { z } from 'zod';
import { getPointsAccount, getOwnedObjects, PACKAGE_ID } from '../sui.js';

export const pointsRouter = Router();

// GET /api/points/:objectId — fetch points account state
pointsRouter.get('/:objectId', async (req, res) => {
  try {
    const { objectId } = req.params;
    if (!/^0x[a-fA-F0-9]{1,64}$/.test(objectId)) {
      return res.status(400).json({ error: 'Invalid object ID' });
    }
    const obj = await getPointsAccount(objectId);
    const fields = obj?.data?.content?.fields;
    if (!fields) return res.status(404).json({ error: 'Points account not found' });

    res.json({
      balance: fields.balance,
      totalEarned: fields.total_earned,
      totalBurned: fields.total_burned,
      streakDays: fields.streak_days,
      pointsToday: fields.points_today,
      owner: fields.owner,
    });
  } catch (err) {
    console.error('[Points] fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch points account' });
  }
});

// GET /api/points/find/:address — find points account for a wallet address
pointsRouter.get('/find/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const typeFilter = `${PACKAGE_ID}::points::PointsAccount`;
    const objects = await getOwnedObjects(address, typeFilter);
    if (!objects || objects.length === 0) {
      return res.status(404).json({ error: 'No points account found' });
    }
    const first = objects[0];
    res.json({
      objectId: first.data?.objectId,
      fields: first.data?.content?.fields,
    });
  } catch (err) {
    console.error('[Points] find error:', err.message);
    res.status(500).json({ error: 'Failed to find points account' });
  }
});
