// routes/conversation.js
import { Router } from 'express';
import { issueServiceCap, getConversationObject, getOwnedObjects, keypair, PACKAGE_ID } from '../sui.js';

export const conversationRouter = Router();

// POST /api/conversation/init — issue service cap after user creates conversation
conversationRouter.post('/init', async (req, res) => {
  try {
    const { conversationObjectId } = req.body;
    if (!conversationObjectId || !/^0x[a-fA-F0-9]{1,64}$/.test(conversationObjectId)) {
      return res.status(400).json({ error: 'Invalid conversation object ID' });
    }

    const aiServiceAddress = keypair.getPublicKey().toSuiAddress();
    const { capObjectId } = await issueServiceCap({
      adminCapObjectId: process.env.ADMIN_CAP_OBJECT_ID,
      conversationObjectId,
      aiServiceAddress,
    });

    res.json({ success: true, aiServiceCapObjectId: capObjectId });
  } catch (err) {
    console.error('[Conversation] init error:', err.message);
    res.status(500).json({ error: 'Failed to initialize conversation' });
  }
});

// GET /api/conversation/:objectId
conversationRouter.get('/:objectId', async (req, res) => {
  try {
    const obj = await getConversationObject(req.params.objectId);
    const fields = obj?.data?.content?.fields;
    if (!fields) return res.status(404).json({ error: 'Conversation not found' });
    res.json({
      totalMessages: fields.total_messages,
      serviceAccessActive: fields.service_access_active,
      createdAtMs: fields.created_at_ms,
      owner: fields.owner,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

// GET /api/conversation/find/:address
conversationRouter.get('/find/:address', async (req, res) => {
  try {
    const typeFilter = `${PACKAGE_ID}::conversation::Conversation`;
    const objects = await getOwnedObjects(req.params.address, typeFilter);
    res.json({ conversations: objects.map(o => ({ objectId: o.data?.objectId, fields: o.data?.content?.fields })) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});
