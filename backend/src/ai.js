/**
 * ai.js — Anthropic Claude integration.
 * 
 * Responsibilities:
 *  1. Generate AI responses using conversation history as context
 *  2. Evaluate message quality and determine point awards
 *  3. Detect and flag rapid/meaningless messages (anti-abuse)
 */
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = 'claude-sonnet-4-20250514';

/**
 * Generate an AI response given decrypted conversation history.
 * Returns: { response: string, qualityBonus: number (0-50), reasoning: string }
 */
export async function generateResponse(conversationHistory, newUserMessage) {
  // Build the system prompt
  const systemPrompt = `You are a helpful, intelligent AI assistant engaged in a meaningful conversation stored on the Sui blockchain.

Your responses should be:
- Thoughtful, substantive, and genuinely helpful
- Clear and well-structured
- Appropriately concise (not verbose for the sake of length)

After providing your main response, you will also evaluate the quality of the interaction for the reward points system.`;

  // Combine history with new message
  const messages = [
    ...conversationHistory.map(msg => ({
      role: msg.role,
      content: msg.content,
    })),
    { role: 'user', content: newUserMessage },
  ];

  // First call: generate the actual response
  const chatResponse = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages,
  });

  const assistantResponse = chatResponse.content[0]?.text || '';

  // Second call: evaluate quality for points (lightweight, separate call)
  const qualityEval = await evaluateInteractionQuality(newUserMessage, assistantResponse);

  return {
    response: assistantResponse,
    qualityBonus: qualityEval.bonus,
    reasoning: qualityEval.reasoning,
    inputTokens: chatResponse.usage.input_tokens,
    outputTokens: chatResponse.usage.output_tokens,
  };
}

/**
 * Evaluate message quality and return a bonus (0–50).
 * 
 * Scoring rubric:
 *   0-10:  Trivial, one-word, or clearly meaningless messages
 *   11-25: Basic factual question or simple request
 *   26-40: Substantive question, creative request, or learning-oriented
 *   41-50: Complex, multi-part, deeply analytical, or highly creative
 * 
 * Also detects rapid-fire/farming patterns.
 */
export async function evaluateInteractionQuality(userMessage, assistantResponse) {
  // Fast heuristic checks before calling the API
  const trimmed = userMessage.trim();
  if (trimmed.length < 3) {
    return { bonus: 0, reasoning: 'Message too short' };
  }

  // Detect obvious spam patterns
  const spamPatterns = [
    /^(.)\1{4,}$/, // Repeated characters: "aaaaaaa"
    /^(hi+|hello+|ok+|yes+|no+|k+)$/i, // Trivial greetings
    /^[^a-zA-Z]*$/, // Only non-letter characters
  ];
  if (spamPatterns.some(p => p.test(trimmed))) {
    return { bonus: 0, reasoning: 'Detected as low-quality or spam pattern' };
  }

  try {
    const evalResponse = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001', // Use fast/cheap model for eval
      max_tokens: 200,
      system: `You evaluate chat messages for quality and assign a bonus points score (0-50 integer only).

Scoring:
- 0-10: trivial, single word, spam, or meaningless
- 11-25: simple greeting, basic factual question
- 26-40: substantive question, learning intent, creative request
- 41-50: complex analysis, multi-part reasoning, deep creative work

Respond with ONLY a JSON object: {"bonus": <number>, "reasoning": "<one sentence>"}
No other text.`,
      messages: [{
        role: 'user',
        content: `User message: "${userMessage.substring(0, 500)}"
AI response length: ${assistantResponse.length} chars

Evaluate the user message quality and assign bonus 0-50.`,
      }],
    });

    const text = evalResponse.content[0]?.text?.trim() || '{"bonus":5,"reasoning":"Default"}';
    const parsed = JSON.parse(text);
    const bonus = Math.min(50, Math.max(0, parseInt(parsed.bonus) || 0));
    return { bonus, reasoning: parsed.reasoning || '' };
  } catch (err) {
    console.warn('[AI eval] Quality evaluation failed, defaulting to 0:', err.message);
    return { bonus: 0, reasoning: 'Evaluation unavailable' };
  }
}

/**
 * Anti-abuse check: detect rapid-fire farming behavior.
 * Returns true if the pattern is suspicious.
 * 
 * Note: primary enforcement is on-chain (10 msgs/60sec limit).
 * This adds an off-chain pre-check to avoid wasted RPC calls.
 */
export function isSuspiciousPattern(recentMessages) {
  if (!recentMessages || recentMessages.length === 0) return false;
  
  const now = Date.now();
  const last60s = recentMessages.filter(m => now - m.timestamp < 60000);
  
  // More than 10 messages in 60 seconds
  if (last60s.length >= 10) return true;
  
  // Check for identical messages (copy-paste farming)
  if (last60s.length >= 3) {
    const contents = last60s.map(m => m.content.trim().toLowerCase());
    const unique = new Set(contents);
    if (unique.size === 1) return true; // All identical
  }
  
  return false;
}
