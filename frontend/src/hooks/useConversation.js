/**
 * useConversation.js
 *
 * Manages:
 * - chat message state
 * - on-chain conversation objects
 * - encryption
 * - backend API interaction
 * - points + token rewards
 */

import { useState, useCallback, useRef } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";

import {
  getOrCreateKey,
  encryptMessage,
  exportKey,
} from "../utils/crypto.js";

import { api } from "../utils/api.js";

const PACKAGE_ID = import.meta.env.VITE_PACKAGE_ID;
const CLOCK_OBJECT_ID = "0x6";

export function useConversation() {

  const account = useCurrentAccount();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [messages, setMessages] = useState([]);
  const [conversationObjectId, setConversationObjectId] = useState(null);
  const [aiServiceCapObjectId, setAiServiceCapObjectId] = useState(null);
  const [pointsAccountObjectId, setPointsAccountObjectId] = useState(null);

  const [points, setPoints] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastPointsAwarded, setLastPointsAwarded] = useState(null);

  const cryptoKeyRef = useRef(null);
  const recentTimestampsRef = useRef([]);

  /* -------------------------------- */
  /* Encryption key management        */
  /* -------------------------------- */

  const getKey = useCallback(async () => {

    if (!account?.address) {
      throw new Error("Wallet not connected");
    }

    if (!cryptoKeyRef.current) {
      cryptoKeyRef.current = await getOrCreateKey(account.address);
    }

    return cryptoKeyRef.current;

  }, [account?.address]);

  /* -------------------------------- */
  /* Create Conversation              */
  /* -------------------------------- */

  const createConversation = useCallback(async () => {

    if (!account?.address) {
      throw new Error("Connect wallet first");
    }

    setError(null);

    const key = await getKey();
    const exportedKey = await exportKey(key);

    const keyBytes = Array.from(
      Uint8Array.from(atob(exportedKey), (c) => c.charCodeAt(0))
    );

    const tx = new Transaction();

    tx.moveCall({
      target: `${PACKAGE_ID}::conversation::create_conversation`,
      arguments: [
        tx.pure.vector("u8", keyBytes),
        tx.object(CLOCK_OBJECT_ID),
      ],
    });

    const result = await signAndExecute({
      transaction: tx,
      options: {
        showObjectChanges: true,
      },
    });

    console.log("Conversation TX Result:", result);

    const created = result.objectChanges?.find(
      (change) =>
        change.type === "created" &&
        change.objectType?.includes("conversation::Conversation")
    );

    if (!created) {
      console.error("ObjectChanges:", result.objectChanges);
      throw new Error("Conversation object not found in transaction");
    }

    const convId = created.objectId;

    setConversationObjectId(convId);

    /* Backend initialization */

    const backendResult = await api.initConversation(convId);

    setAiServiceCapObjectId(
      backendResult.aiServiceCapObjectId
    );

    return {
      conversationObjectId: convId,
      aiServiceCapObjectId: backendResult.aiServiceCapObjectId,
    };

  }, [account, getKey, signAndExecute]);

  /* -------------------------------- */
  /* Create Points Account            */
  /* -------------------------------- */

  const createPointsAccount = useCallback(async () => {

    if (!account?.address) {
      throw new Error("Connect wallet first");
    }

    const tx = new Transaction();

    tx.moveCall({
      target: `${PACKAGE_ID}::points::create_account`,
      arguments: [
        tx.object(CLOCK_OBJECT_ID),
      ],
    });

    const result = await signAndExecute({
      transaction: tx,
      options: {
        showObjectChanges: true,
      },
    });

    console.log("Points TX Result:", result);

    const created = result.objectChanges?.find(
      (change) =>
        change.type === "created" &&
        change.objectType?.includes("points::PointsAccount")
    );

    if (!created) {
      console.error("ObjectChanges:", result.objectChanges);
      throw new Error("Points account object not found");
    }

    const pointsId = created.objectId;

    setPointsAccountObjectId(pointsId);

    return pointsId;

  }, [account, signAndExecute]);

  /* -------------------------------- */
  /* Send Message                     */
  /* -------------------------------- */

  const sendMessage = useCallback(
    async (text) => {

      if (!text.trim() || isLoading) return;

      if (!conversationObjectId || !aiServiceCapObjectId) {
        throw new Error("No active conversation");
      }

      setIsLoading(true);
      setError(null);

      const key = await getKey();
      const now = Date.now();

      recentTimestampsRef.current = [
        ...recentTimestampsRef.current.filter(
          (t) => now - t < 60000
        ),
        now,
      ];

      const userMsg = {
        role: "user",
        content: text,
        timestamp: now,
      };

      setMessages((prev) => [...prev, userMsg]);

      try {

        const encryptedUser = await encryptMessage(
          JSON.stringify(userMsg),
          key
        );

        const history = [...messages, userMsg].map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const result = await api.sendMessage({
          userMessage: text,
          conversationHistory: history,
          encryptedUserMessage: encryptedUser,
          conversationObjectId,
          aiServiceCapObjectId,
          pointsAccountObjectId,
          recentMessageTimestamps: recentTimestampsRef.current,
        });

        const { response, qualityBonus } = result;

        const assistantMsg = {
          role: "assistant",
          content: response,
          timestamp: Date.now(),
        };

        setMessages((prev) => [...prev, assistantMsg]);

        const encryptedAssistant = await encryptMessage(
          JSON.stringify(assistantMsg),
          key
        );

        api.storeResponse({
          conversationObjectId,
          aiServiceCapObjectId,
          encryptedAssistantMessage: encryptedAssistant,
        });

        if (qualityBonus !== undefined) {

          const base = 10;

          setLastPointsAwarded({
            base,
            bonus: qualityBonus,
            total: base + qualityBonus,
          });

          if (pointsAccountObjectId) {

            setTimeout(async () => {

              try {
                const updated = await api.getPoints(
                  pointsAccountObjectId
                );

                setPoints(updated);

              } catch {}

            }, 3000);

          }

        }

      } catch (err) {

        console.error(err);

        setError(err.message);

        setMessages((prev) =>
          prev.filter((m) => m !== userMsg)
        );

      } finally {

        setIsLoading(false);

      }

    },
    [
      conversationObjectId,
      aiServiceCapObjectId,
      pointsAccountObjectId,
      messages,
      getKey,
      isLoading,
    ]
  );

  /* -------------------------------- */
  /* Load existing conversation       */
  /* -------------------------------- */

  const loadConversation = useCallback(
    async (convId, capId, pointsId) => {

      setConversationObjectId(convId);
      setAiServiceCapObjectId(capId);
      setPointsAccountObjectId(pointsId);

      if (pointsId) {
        try {
          const pts = await api.getPoints(pointsId);
          setPoints(pts);
        } catch {}
      }

      setMessages([]);

    },
    []
  );

  /* -------------------------------- */
  /* Export history                   */
  /* -------------------------------- */

  const exportHistory = useCallback(() => {
    return messages;
  }, [messages]);

  /* -------------------------------- */
  /* Mint AURA Tokens                 */
  /* -------------------------------- */

  const mintTokens = useCallback(
    async (tokenAmount) => {

      if (!pointsAccountObjectId) {
        throw new Error("No points account");
      }

      const result = await api.mintTokens(
        pointsAccountObjectId,
        tokenAmount
      );

      const updated = await api.getPoints(
        pointsAccountObjectId
      );

      setPoints(updated);

      return result;

    },
    [pointsAccountObjectId]
  );

  return {

    messages,
    isLoading,
    error,
    points,
    lastPointsAwarded,

    conversationObjectId,
    aiServiceCapObjectId,
    pointsAccountObjectId,

    createConversation,
    createPointsAccount,
    sendMessage,
    loadConversation,
    exportHistory,
    mintTokens,

    setConversationObjectId,
    setAiServiceCapObjectId,
    setPointsAccountObjectId,

  };
}