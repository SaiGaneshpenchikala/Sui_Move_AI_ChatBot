# AURA — Encrypted AI Chat on Sui

> Encrypted AI conversations stored on-chain. Earn points for meaningful interactions. Mint reward tokens.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser (Frontend)                                                  │
│                                                                      │
│  ┌──────────────┐   plaintext (AI only)   ┌──────────────────────┐ │
│  │ React UI     │────────────────────────▶│ Node.js Backend      │ │
│  │ + Sui Wallet │◀────────────────────────│ (Express)            │ │
│  │ + SubtleCrypto│   response + quality   │  · Anthropic Claude  │ │
│  └──────────────┘                         │  · Sui SDK (AI svc)  │ │
│         │                                 └──────────────────────┘ │
│         │ encrypted blobs only                        │             │
│         ▼                                             │             │
│  ┌──────────────┐                                     │             │
│  │  Sui Wallet  │◀────────────────────────────────────┘             │
│  │  (sign txs)  │        award_points, append_message               │
│  └──────────────┘                                                   │
│         │                                                            │
└─────────┼────────────────────────────────────────────────────────── ┘
          │ signed transactions
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Sui Blockchain                                                      │
│                                                                      │
│  ┌─────────────────┐   ┌──────────────────┐   ┌─────────────────┐  │
│  │  Conversation   │   │  PointsAccount   │   │  AURA Token     │  │
│  │  (user-owned)   │   │  (user-owned)    │   │  (fungible)     │  │
│  │                 │   │                  │   │                  │  │
│  │ messages[]      │   │ balance: u64     │   │ TreasuryCap     │  │
│  │ ciphertext+iv   │   │ streak_days      │   │ max_supply      │  │
│  │ encrypted_key   │   │ daily_cap track  │   │ mint (AI only)  │  │
│  │ AIServiceCap ✓  │   │ earn_history     │   │ burn (anyone)   │  │
│  └─────────────────┘   └──────────────────┘   └─────────────────┘  │
│                                                                      │
│  Capability Objects (held by AI service wallet):                     │
│  AdminCap · PointsAdminCap · MintCap                                │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow — Sending a Message

1. User types message → browser **encrypts** it with AES-256-GCM (SubtleCrypto API)
2. Frontend sends **plaintext** to backend (for AI inference) + **ciphertext** (for on-chain storage)
3. Backend calls Claude → gets AI response + quality score (0-50)
4. Backend calls `conversation::append_message` → stores encrypted user message on-chain
5. Backend returns response to frontend; frontend encrypts it → calls `/store-response`
6. Backend calls `conversation::append_message` for assistant message (async)
7. Backend calls `points::award_points` with quality bonus (async, best-effort)
8. Frontend displays response, updates points counter

---

## Smart Contracts

### Module: `conversation`

| Function | Caller | Description |
|----------|--------|-------------|
| `create_conversation` | User | Creates Conversation object owned by user |
| `issue_service_cap` | Admin | Issues AIServiceCap to AI backend |
| `append_message` | AI (via cap) | Appends encrypted message |
| `revoke_service_access` | User | Destroys AIServiceCap, permanently blocks write |

**Key design**: The `AIServiceCap` is a Sui object. Revoking = deleting the object. Once deleted, no new cap can grant access to a conversation where `service_access_active == false`.

### Module: `points`

| Mechanism | Implementation |
|-----------|----------------|
| Base points | 10 pts per `award_points` call |
| Quality bonus | 0-50 pts (AI-determined, capped on-chain) |
| Daily streak | Fixed-point multiplier: 1x/1.5x/2x/3x |
| Daily cap | 500 pts/day (resets at UTC midnight) |
| Anti-abuse | Rejects >10 msgs in 60s window (rolling buffer) |
| Theme unlock | Burn 200 pts for cosmetic theme (second burn mechanism) |

### Module: `reward_token`

- **One-time witness** pattern for `coin::create_currency`
- **Atomic mint-burn**: `mint_tokens` calls `points::burn_for_tokens` before `coin::mint` — both succeed or neither does
- **Exchange rate**: 100 points = 1 AURA
- **Max supply**: 100M AURA (configurable in `TokenConfig`)
- Metadata is **frozen** after deployment (immutable symbol/name/decimals)

---

## Security Model

### What's encrypted
- **All message content** — AES-256-GCM, encrypted in the browser before the request leaves the device
- **Encrypted key stored on-chain** — the `Conversation` object stores the wrapped encryption key (in production: wrapped with user's public key so it's recoverable cross-device)

### What the backend sees (transiently)
- Plaintext messages for **AI inference only** — the message passes through the backend's memory during the API call and is never persisted server-side
- This is a **necessary trade-off**: Claude must process plaintext. Users who require zero server-side plaintext can run the backend locally

### Capability pattern
- **AdminCap**: issues `AIServiceCap` objects. Held by the protocol deployer
- **AIServiceCap**: per-conversation write access. One-to-one with a conversation. Destroyable by the user
- **PointsAdminCap**: gates `award_points`. Held by AI service wallet
- **MintCap**: gates `mint_tokens`. Held by AI service wallet
- **No sudo/backdoor**: once a cap is revoked/burned, the operation is permanently blocked on-chain

### User data ownership
- All user objects (`Conversation`, `PointsAccount`, minted `Coin<REWARD_TOKEN>`) are `transfer::transfer`-ed to the user's address
- The protocol never holds user objects — they exist in the user's wallet

---

## Setup Instructions

### Prerequisites
- [Sui CLI](https://docs.sui.io/build/install) installed and configured
- Node.js 20+
- A Sui testnet wallet with SUI for gas

### 1. Deploy Smart Contracts

```bash
cd contracts

# Build
sui move build

# Run tests
sui move test

# Deploy to testnet
sui client publish --gas-budget 100000000
```

After deployment, note the **Package ID** and the IDs of:
- `AdminCap` (sent to deployer)
- `PointsAdminCap` (sent to deployer)
- `TokenConfig` (shared object)
- `TreasuryCap<REWARD_TOKEN>` (sent to deployer)
- `MintCap` (sent to deployer)

Transfer capability objects to your AI service wallet:
```bash
# Transfer PointsAdminCap to AI service wallet
sui client transfer --to <AI_SERVICE_ADDR> --object-id <POINTS_ADMIN_CAP_ID> --gas-budget 10000000

# Transfer MintCap
sui client transfer --to <AI_SERVICE_ADDR> --object-id <MINT_CAP_ID> --gas-budget 10000000

# Transfer TreasuryCap
sui client transfer --to <AI_SERVICE_ADDR> --object-id <TREASURY_CAP_ID> --gas-budget 10000000

# Keep AdminCap with the deployer (or a multisig)
```

### 2. Configure Backend

```bash
cd backend
cp .env.example .env
npm install
```

Edit `.env`:
```env
ANTHROPIC_API_KEY=sk-ant-...
SUI_NETWORK=testnet
AI_SERVICE_PRIVATE_KEY=0x<hex key for AI service wallet>
PACKAGE_ID=0x<deployed package>
TOKEN_CONFIG_OBJECT_ID=0x...
TREASURY_CAP_OBJECT_ID=0x...
MINT_CAP_OBJECT_ID=0x...
POINTS_ADMIN_CAP_OBJECT_ID=0x...
ADMIN_CAP_OBJECT_ID=0x...
```

```bash
npm start
# Backend runs on http://localhost:3001
```

### 3. Configure Frontend

```bash
cd frontend
cp .env.example .env
# Set VITE_PACKAGE_ID to your deployed package ID
npm install
npm run dev
# Frontend runs on http://localhost:3000
```

### 4. Using the App

1. Open `http://localhost:3000`
2. Connect your Sui wallet (Sui Wallet, Suiet, etc.)
3. Click **"Create Vault & Points Account"** — this signs 2 transactions:
   - Creates an on-chain `Conversation` object owned by your wallet
   - Creates a `PointsAccount` owned by your wallet
4. The backend issues an `AIServiceCap` for your conversation
5. Start chatting! Each message:
   - Is encrypted client-side with AES-256-GCM
   - Gets stored on-chain as an encrypted blob
   - Earns you 10-60 points based on quality
6. Accumulate 100+ points to redeem AURA tokens via the **Redeem** panel

---

## Trade-offs & Design Decisions

### 1. Backend sees plaintext transiently
**Problem**: Claude needs plaintext to generate responses.  
**Decision**: Accept this trade-off; document it clearly. Messages are never persisted server-side.  
**Alternative considered**: ZK proofs / homomorphic encryption — not practical for LLM inference today.  
**Mitigation**: Open-source the backend so privacy-sensitive users can self-host.

### 2. Encryption key stored in localStorage
**Problem**: If the user clears localStorage, they lose their key and cannot decrypt history.  
**Decision**: Pragmatic for a demo. For production, derive the key deterministically from a wallet signature (`signPersonalMessage`) so it's recoverable from the wallet seed phrase.  
**Status**: The architecture supports this upgrade — `getOrCreateKey` is the only function to change.

### 3. Points awarded best-effort (async)
**Problem**: The points award transaction is separate from the message transaction.  
**Decision**: Fire-and-forget after the AI response is returned. Simplifies the user flow.  
**Risk**: Backend crash between response and award = user loses points for that message.  
**Alternative**: Bundle everything in one PTB (Programmable Transaction Block) — requires the AI response content to be available before the tx is built, which means latency hit.

### 4. AIServiceCap is held by the backend, not the user
**Problem**: The backend signs `append_message` calls, not the user.  
**Decision**: Necessary for UX — requiring the user to sign every message would be unusable.  
**Security**: Users can revoke access at any time; the capability pattern ensures no out-of-band writes are possible once revoked.

### 5. Message history loaded from local memory, not re-read from chain
**Problem**: Re-reading and decrypting all on-chain messages on every load is expensive.  
**Decision**: Session messages are kept in React state. The on-chain store is the durable backup.  
**Export flow**: `exportHistory()` can be extended to read all on-chain ciphertexts and decrypt them with the user's key.

### 6. Daily cap enforced per-transaction, not globally atomic
**Problem**: Multiple concurrent transactions could theoretically exceed the daily cap before each one's state update is visible.  
**Decision**: Accepted for now — the cap is an anti-abuse measure, not a financial guarantee. The on-chain window check + off-chain rate limiter together make farming impractical.

---

## Project Structure

```
sui-ai-chat/
├── contracts/
│   ├── Move.toml
│   ├── sources/
│   │   ├── conversation.move   # Encrypted message storage
│   │   ├── points.move         # Earn/burn points ledger
│   │   └── reward_token.move   # AURA fungible token
│   └── tests/
│       └── tests.move          # Full test suite
├── backend/
│   ├── package.json
│   ├── .env.example
│   └── src/
│       ├── index.js            # Express server
│       ├── ai.js               # Claude integration + quality eval
│       ├── sui.js              # Sui blockchain service
│       ├── crypto.js           # Ciphertext validation utils
│       └── routes/
│           ├── chat.js         # POST /api/chat/message
│           ├── points.js       # GET /api/points/:id
│           ├── token.js        # POST /api/token/mint
│           └── conversation.js # Conversation management
└── frontend/
    ├── index.html
    ├── vite.config.js
    ├── .env.example
    └── src/
        ├── main.jsx
        ├── App.jsx             # Main UI: chat + points + redemption
        ├── hooks/
        │   └── useConversation.js  # State management + Sui txs
        └── utils/
            ├── crypto.js       # AES-256-GCM (SubtleCrypto)
            └── api.js          # Backend API client
```

---

## Points System Summary

| Mechanism | Amount | Condition |
|-----------|--------|-----------|
| Base | 10 pts | Every message |
| Quality bonus | 0-50 pts | AI evaluation |
| Streak 1 day | 1.5x multiplier | Consecutive day |
| Streak 2 days | 2x multiplier | Two consecutive days |
| Streak 3+ days | 3x multiplier | Three or more consecutive days |
| Daily cap | Max 500 pts/day | Anti-abuse |
| Anti-spam | 0 pts | >10 msgs/60sec |

| Redemption | Cost |
|------------|------|
| 1 AURA token | 100 pts |
| Cyberpunk theme | 200 pts |

---

## Demo Flow

1. **Connect** Sui wallet
2. **Initialize** — creates `Conversation` + `PointsAccount` on Sui testnet (2 txs)
3. **Chat** — send a substantive question, watch points appear
4. **Streak** — return the next day, see the multiplier kick in
5. **Redeem** — accumulate 100+ points, open the Redeem panel, mint 1 AURA
6. **Verify** — check your wallet in Sui Explorer — you'll see the `Conversation` object with encrypted message blobs, the `PointsAccount` with updated balance, and `Coin<AURA>` in your wallet
7. **Revoke** — call `revoke_service_access` directly in Sui Explorer to permanently block the AI from writing to your conversation

---

## License

MIT
