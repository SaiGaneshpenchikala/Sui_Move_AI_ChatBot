/**
 * sui.js — Sui blockchain interaction layer.
 * The AI backend service uses this to:
 *   1. Append encrypted messages to conversation objects
 *   2. Award points to users after AI evaluation
 *   3. Mint AURA tokens when users redeem points
 *   4. Issue AIServiceCap objects to users
 */
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';

const { secretKey } = decodeSuiPrivateKey(process.env.AI_SERVICE_PRIVATE_KEY);
const keypair = Ed25519Keypair.fromSecretKey(secretKey);

const suiClient = new SuiClient({
  url: getFullnodeUrl(process.env.SUI_NETWORK || 'testnet'),
});

const PACKAGE_ID = process.env.PACKAGE_ID || '0x0';

/**
 * Append an encrypted message to a user's on-chain Conversation object.
 * Called after each AI response is generated.
 */
export async function appendMessage({
  conversationObjectId,
  aiServiceCapObjectId,
  clockObjectId = '0x6',
  role,            // 'user' | 'assistant'
  ciphertext,      // Buffer — AES-256-GCM encrypted message
  iv,              // Buffer — 12-byte IV
}) {
  const tx = new Transaction();

  tx.moveCall({
    target: `${PACKAGE_ID}::conversation::append_message`,
    arguments: [
      tx.object(aiServiceCapObjectId),
      tx.object(conversationObjectId),
      tx.pure.string(role),
      tx.pure.vector('u8', Array.from(ciphertext)),
      tx.pure.vector('u8', Array.from(iv)),
      tx.object(clockObjectId),
    ],
  });

  const result = await suiClient.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEffects: true, showEvents: true },
  });

  if (result.effects?.status?.status !== 'success') {
    throw new Error(`append_message failed: ${JSON.stringify(result.effects?.status)}`);
  }

  return result;
}

/**
 * Award points to a user. Called after the AI evaluates message quality.
 * qualityBonus: 0-50 (integer)
 */
export async function awardPoints({
  pointsAccountObjectId,
  pointsAdminCapObjectId,
  clockObjectId = '0x6',
  qualityBonus = 0,
}) {
  const tx = new Transaction();

  tx.moveCall({
    target: `${PACKAGE_ID}::points::award_points`,
    arguments: [
      tx.object(pointsAdminCapObjectId),
      tx.object(pointsAccountObjectId),
      tx.pure.u64(Math.min(50, Math.max(0, Math.floor(qualityBonus)))),
      tx.object(clockObjectId),
    ],
  });

  const result = await suiClient.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEffects: true, showEvents: true },
  });

  if (result.effects?.status?.status !== 'success') {
    throw new Error(`award_points failed: ${JSON.stringify(result.effects?.status)}`);
  }

  return result;
}

/**
 * Mint AURA tokens for a user — atomically burns their points.
 * tokenAmount: whole number of AURA tokens to mint.
 */
export async function mintTokens({
  mintCapObjectId,
  treasuryCapObjectId,
  tokenConfigObjectId,
  pointsAccountObjectId,
  clockObjectId = '0x6',
  tokenAmount,
}) {
  const tx = new Transaction();

  tx.moveCall({
    target: `${PACKAGE_ID}::reward_token::mint_tokens`,
    arguments: [
      tx.object(mintCapObjectId),
      tx.object(treasuryCapObjectId),
      tx.object(tokenConfigObjectId),
      tx.object(pointsAccountObjectId),
      tx.pure.u64(tokenAmount),
      tx.object(clockObjectId),
    ],
  });

  const result = await suiClient.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEffects: true, showEvents: true },
  });

  if (result.effects?.status?.status !== 'success') {
    throw new Error(`mint_tokens failed: ${JSON.stringify(result.effects?.status)}`);
  }

  return result;
}

/**
 * Issue an AIServiceCap to the AI service for a new conversation.
 */
export async function issueServiceCap({
  adminCapObjectId,
  conversationObjectId,
  aiServiceAddress,
}) {
  const tx = new Transaction();

  tx.moveCall({
    target: `${PACKAGE_ID}::conversation::issue_service_cap`,
    arguments: [
      tx.object(adminCapObjectId),
      tx.pure.address(conversationObjectId),
      tx.pure.address(aiServiceAddress),
    ],
  });

  const result = await suiClient.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEffects: true, showEvents: true },
  });

  if (result.effects?.status?.status !== 'success') {
    throw new Error(`issue_service_cap failed`);
  }

  // Extract the new AIServiceCap object ID from created objects
  const createdCap = result.effects?.created?.find(
    (obj) => obj.owner?.AddressOwner === keypair.getPublicKey().toSuiAddress()
  );

  return { result, capObjectId: createdCap?.reference?.objectId };
}

/**
 * Fetch a Conversation object to read on-chain message count and metadata.
 */
export async function getConversationObject(objectId) {
  const obj = await suiClient.getObject({
    id: objectId,
    options: { showContent: true },
  });
  return obj;
}

/**
 * Fetch a PointsAccount object.
 */
export async function getPointsAccount(objectId) {
  const obj = await suiClient.getObject({
    id: objectId,
    options: { showContent: true },
  });
  return obj;
}

/**
 * Get objects owned by an address filtered by type.
 */
export async function getOwnedObjects(ownerAddress, typeFilter) {
  const { data } = await suiClient.getOwnedObjects({
    owner: ownerAddress,
    filter: { StructType: typeFilter },
    options: { showContent: true },
  });
  return data;
}

export { suiClient, keypair, PACKAGE_ID };
