/**
 * api.js — Backend API client.
 */

const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  /**
   * Send a chat message and get AI response.
   */
  sendMessage: (payload) =>
    request('/chat/message', { method: 'POST', body: JSON.stringify(payload) }),

  /**
   * Store encrypted assistant response on-chain.
   */
  storeResponse: (payload) =>
    request('/chat/store-response', { method: 'POST', body: JSON.stringify(payload) }),

  /**
   * Initialize a conversation (issue service cap) after user creates it.
   */
  initConversation: (conversationObjectId) =>
    request('/conversation/init', { method: 'POST', body: JSON.stringify({ conversationObjectId }) }),

  /**
   * Find conversations owned by a wallet address.
   */
  findConversations: (address) =>
    request(`/conversation/find/${address}`),

  /**
   * Fetch points account state.
   */
  getPoints: (objectId) =>
    request(`/points/${objectId}`),

  /**
   * Find points account for a wallet address.
   */
  findPoints: (address) =>
    request(`/points/find/${address}`),

  /**
   * Mint AURA tokens by burning points.
   */
  mintTokens: (pointsAccountObjectId, tokenAmount) =>
    request('/token/mint', {
      method: 'POST',
      body: JSON.stringify({ pointsAccountObjectId, tokenAmount }),
    }),
};
