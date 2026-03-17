/**
 * routes/chat.js
 * 
 * POST /api/chat/message
 * 
 * Flow:
 *  1. Receive user message (plaintext — the frontend sends it for AI context)
 *     + encrypted bundles for both user msg and (later) assistant response
 *  2. Load conversation history from Sui (decrypted by frontend, passed as context)
 *  3. Generate AI response via Claude
 *  4. Store BOTH messages on-chain (encrypted)
 *  5. Evaluate quality → award points on-chain
 *  6. Return response to frontend
 * 
 * Security note: The backend receives plaintext for AI inference ONLY.
 * The encrypted versions are what get stored on-chain permanently.
 * Users who need full privacy can run the backend locally.
 */
import { Router } from 'express';
import { z } from 'zod';
import { generateResponse, isSuspiciousPattern } from '../ai.js';
import { appendMessage, awardPoints } from '../sui.js';
import { validateCiphertextBundle, base64ToBytes } from '../crypto.js';

export const chatRouter = Router();

const MessageSchema = z.object({
  // Plaintext for AI context
  userMessage: z.string().min(1).max(4000),
  // Conversation history (decrypted by frontend, for AI context)
  conversationHistory: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).max(50),
  // Encrypted bundles to store on-chain
  encryptedUserMessage: z.object({
    ciphertext: z.string(),
    iv: z.string(),
  }),
  // Sui object IDs
  conversationObjectId: z.string(),
  aiServiceCapObjectId: z.string(),
  pointsAccountObjectId: z.string(),
  // Recent message timestamps for anti-abuse pre-check
  recentMessageTimestamps: z.array(z.number()).max(20).optional(),
});

chatRouter.post('/message', async (req, res) => {
  try {
    const parsed = MessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const {
      userMessage,
      conversationHistory,
      encryptedUserMessage,
      conversationObjectId,
      aiServiceCapObjectId,
      pointsAccountObjectId,
      recentMessageTimestamps,
    } = parsed.data;

    // Validate encrypted user message bundle
    if (!validateCiphertextBundle(encryptedUserMessage)) {
      return res.status(400).json({ error: 'Invalid encrypted message format' });
    }

    // Anti-abuse pre-check
    if (recentMessageTimestamps && isSuspiciousPattern(
      recentMessageTimestamps.map(ts => ({ timestamp: ts, content: userMessage }))
    )) {
      return res.status(429).json({ error: 'Message rate limit exceeded. Please slow down.' });
    }

    // 1. Generate AI response
    const aiResult = await generateResponse(conversationHistory, userMessage);
    const { response: assistantText, qualityBonus } = aiResult;

    // 2. Store user message on-chain (encrypted)
    //    The frontend passes us the encrypted user message to store
    try {
      await appendMessage({
        conversationObjectId,
        aiServiceCapObjectId,
        role: 'user',
        ciphertext: base64ToBytes(encryptedUserMessage.ciphertext),
        iv: base64ToBytes(encryptedUserMessage.iv),
      });
    } catch (err) {
      console.error('[Sui] append user message failed:', err.message);
      // Continue — don't fail the whole chat if blockchain write fails
    }

    // 3. Return response to frontend immediately (don't wait for on-chain ops)
    //    Frontend will encrypt the assistant response and send it back
    //    via a separate /api/chat/store-response call
    res.json({
      response: assistantText,
      qualityBonus,
      pointsObjectId: pointsAccountObjectId,
    });

    // 4. Award points asynchronously (best-effort)
    setImmediate(async () => {
      try {
        await awardPoints({
          pointsAccountObjectId,
          pointsAdminCapObjectId: process.env.POINTS_ADMIN_CAP_OBJECT_ID,
          qualityBonus,
        });
        console.log(`[Points] Awarded ${10 + qualityBonus} pts (bonus: ${qualityBonus})`);
      } catch (err) {
        console.error('[Points] award failed:', err.message);
      }
    });

  } catch (err) {
    console.error('[Chat] Error:', err);
    if (err.message?.includes('Could not process request')) {
      return res.status(503).json({ error: 'AI service temporarily unavailable' });
    }
    res.status(500).json({ error: 'Failed to generate response' });
  }
});

// Store encrypted assistant response on-chain
const StoreResponseSchema = z.object({
  conversationObjectId: z.string(),
  aiServiceCapObjectId: z.string(),
  encryptedAssistantMessage: z.object({
    ciphertext: z.string(),
    iv: z.string(),
  }),
});

chatRouter.post('/store-response', async (req, res) => {
  try {
    const parsed = StoreResponseSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const { conversationObjectId, aiServiceCapObjectId, encryptedAssistantMessage } = parsed.data;

    if (!validateCiphertextBundle(encryptedAssistantMessage)) {
      return res.status(400).json({ error: 'Invalid encrypted message format' });
    }

    await appendMessage({
      conversationObjectId,
      aiServiceCapObjectId,
      role: 'assistant',
      ciphertext: base64ToBytes(encryptedAssistantMessage.ciphertext),
      iv: base64ToBytes(encryptedAssistantMessage.iv),
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[Chat] store-response failed:', err.message);
    res.status(500).json({ error: 'Failed to store response on-chain' });
  }
});
