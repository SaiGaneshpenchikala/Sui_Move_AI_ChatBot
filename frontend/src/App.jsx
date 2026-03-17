import { useState, useRef, useEffect } from 'react';
import "@mysten/dapp-kit/dist/index.css";
import {
  ConnectButton,
  useCurrentAccount,
  SuiClientProvider,
  WalletProvider,
} from '@mysten/dapp-kit';
import { getFullnodeUrl } from '@mysten/sui/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useConversation } from './hooks/useConversation.js';

const queryClient = new QueryClient();
const networks = { testnet: { url: getFullnodeUrl('testnet') } };

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networks} defaultNetwork="testnet">
        <WalletProvider autoConnect>
          <ChatApp />
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}

function ChatApp() {
  const account = useCurrentAccount();
  const {
    messages, isLoading, error, points, lastPointsAwarded,
    conversationObjectId, pointsAccountObjectId,
    createConversation, createPointsAccount, sendMessage,
    mintTokens,
  } = useConversation();

  const [input, setInput] = useState('');
  const [setupStep, setSetupStep] = useState('idle'); // idle | creating | ready
  const [mintAmount, setMintAmount] = useState(1);
  const [mintStatus, setMintStatus] = useState(null);
  const [showRedemption, setShowRedemption] = useState(false);
  const [notification, setNotification] = useState(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (lastPointsAwarded) {
      showNotification(`+${lastPointsAwarded.total} pts${lastPointsAwarded.bonus > 0 ? ` (${lastPointsAwarded.bonus} quality bonus!)` : ''}`);
    }
  }, [lastPointsAwarded]);

  function showNotification(msg) {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  }

  async function handleSetup() {
    setSetupStep('creating');
    try {
      await createConversation();
      await createPointsAccount();
      setSetupStep('ready');
    } catch (e) {
      setSetupStep('idle');
      alert('Setup failed: ' + e.message);
    }
  }

  async function handleSend(e) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    const text = input;
    setInput('');
    await sendMessage(text);
  }

  async function handleMint() {
    setMintStatus('minting');
    try {
      const result = await mintTokens(mintAmount);
      setMintStatus('success');
      showNotification(`Minted ${mintAmount} AURA! Burned ${mintAmount * 100} pts`);
      setTimeout(() => setMintStatus(null), 4000);
    } catch (e) {
      setMintStatus('error:' + e.message);
    }
  }

  const isSetup = conversationObjectId && pointsAccountObjectId;
  const balance = points ? parseInt(points.balance) : 0;
  const streak = points ? parseInt(points.streakDays) : 0;
  const pointsToday = points ? parseInt(points.pointsToday) : 0;

  if (!account) {
    return <LandingScreen />;
  }

  return (
    <div style={styles.root}>
      {/* Notification toast */}
      {notification && (
        <div style={styles.toast}>{notification}</div>
      )}

      {/* Sidebar */}
      <aside style={styles.sidebar}>
        <div style={styles.sidebarLogo}>
          <span style={styles.logoMark}>◈</span>
          <span style={styles.logoText}>AURA</span>
        </div>

        <div style={styles.walletBadge}>
          <div style={styles.walletDot} />
          <span style={styles.walletAddr}>
            {account.address.slice(0, 6)}…{account.address.slice(-4)}
          </span>
        </div>

        {isSetup && (
          <>
            <div style={styles.statsBlock}>
              <div style={styles.statRow}>
                <span style={styles.statLabel}>Balance</span>
                <span style={styles.statValue}>{balance.toLocaleString()} pts</span>
              </div>
              <div style={styles.statRow}>
                <span style={styles.statLabel}>Today</span>
                <span style={styles.statValue}>{pointsToday} / 500</span>
              </div>
              <div style={styles.statRow}>
                <span style={styles.statLabel}>Streak</span>
                <span style={styles.statValue}>{streak} 🔥</span>
              </div>
            </div>

            <div style={styles.progressBar}>
              <div style={{ ...styles.progressFill, width: `${Math.min(100, (pointsToday / 500) * 100)}%` }} />
            </div>
            <div style={styles.progressLabel}>Daily cap: {pointsToday}/500</div>

            <button style={styles.redeemBtn} onClick={() => setShowRedemption(!showRedemption)}>
              {showRedemption ? '✕ Close' : '⬡ Redeem Tokens'}
            </button>

            {showRedemption && (
              <div style={styles.redeemPanel}>
                <div style={styles.redeemTitle}>Mint AURA Tokens</div>
                <div style={styles.redeemRate}>100 pts → 1 AURA</div>
                <div style={styles.mintRow}>
                  <button style={styles.adjBtn} onClick={() => setMintAmount(Math.max(1, mintAmount - 1))}>−</button>
                  <span style={styles.mintAmt}>{mintAmount}</span>
                  <button style={styles.adjBtn} onClick={() => setMintAmount(Math.min(Math.floor(balance / 100), mintAmount + 1))}>+</button>
                </div>
                <div style={styles.mintCost}>Cost: {mintAmount * 100} pts</div>
                <button
                  style={{
                    ...styles.mintBtn,
                    opacity: balance < mintAmount * 100 || mintStatus === 'minting' ? 0.5 : 1,
                  }}
                  onClick={handleMint}
                  disabled={balance < mintAmount * 100 || mintStatus === 'minting'}
                >
                  {mintStatus === 'minting' ? 'Minting…' :
                   mintStatus === 'success' ? '✓ Minted!' : 'Mint AURA'}
                </button>
                {mintStatus?.startsWith('error:') && (
                  <div style={styles.mintError}>{mintStatus.slice(6)}</div>
                )}

                <div style={{ marginTop: 16, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 12 }}>
                  <div style={styles.redeemTitle}>Unlock Theme</div>
                  <div style={styles.redeemRate}>200 pts → Cyberpunk UI</div>
                  <button
                    style={{ ...styles.mintBtn, marginTop: 8, background: 'rgba(120,80,255,0.3)', opacity: balance < 200 ? 0.5 : 1 }}
                    disabled={balance < 200}
                  >
                    Unlock (200 pts)
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        <div style={styles.sidebarFooter}>
          <ConnectButton style={styles.connectBtn} />
        </div>
      </aside>

      {/* Main */}
      <main style={styles.main}>
        {!isSetup ? (
          <div style={styles.setupScreen}>
            <div style={styles.setupCard}>
              <div style={styles.setupIcon}>◈</div>
              <h2 style={styles.setupTitle}>Initialize Your Vault</h2>
              <p style={styles.setupDesc}>
                Create your on-chain encrypted conversation vault and points account.
                Your messages are encrypted client-side before touching the blockchain.
              </p>
              <div style={styles.setupFeatures}>
                {['AES-256-GCM client-side encryption', 'Conversation history on Sui', 'Earn points for quality chat', 'Mint AURA reward tokens'].map(f => (
                  <div key={f} style={styles.featureItem}>
                    <span style={styles.featureCheck}>✓</span> {f}
                  </div>
                ))}
              </div>
              <button
                style={styles.setupBtn}
                onClick={handleSetup}
                disabled={setupStep === 'creating'}
              >
                {setupStep === 'creating' ? 'Creating on-chain…' : 'Create Vault & Points Account'}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <header style={styles.chatHeader}>
              <div style={styles.headerLeft}>
                <span style={styles.headerTitle}>Encrypted Chat</span>
                <span style={styles.headerSub}>
                  {conversationObjectId?.slice(0, 8)}… · {messages.length} messages
                </span>
              </div>
              <div style={styles.headerRight}>
                <span style={styles.encBadge}>🔒 AES-256</span>
                <span style={styles.chainBadge}>⛓ Sui</span>
              </div>
            </header>

            {/* Messages */}
            <div style={styles.messages}>
              {messages.length === 0 && (
                <div style={styles.emptyState}>
                  <div style={styles.emptyIcon}>◈</div>
                  <p style={styles.emptyText}>Start a conversation. Each message is encrypted and stored on Sui.</p>
                  <p style={styles.emptyHint}>Earn up to 60 pts per thoughtful message (10 base + 50 quality bonus)</p>
                </div>
              )}
              {messages.map((msg, i) => (
                <MessageBubble key={i} message={msg} />
              ))}
              {isLoading && <TypingIndicator />}
              <div ref={messagesEndRef} />
            </div>

            {/* Error */}
            {error && (
              <div style={styles.errorBanner}>⚠ {error}</div>
            )}

            {/* Input */}
            <form style={styles.inputArea} onSubmit={handleSend}>
              <input
                style={styles.input}
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Send a message… (encrypted before storage)"
                disabled={isLoading}
                autoFocus
              />
              <button type="submit" style={styles.sendBtn} disabled={isLoading || !input.trim()}>
                <span style={{ fontSize: 18 }}>↑</span>
              </button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}

function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  return (
    <div style={{ ...styles.bubbleRow, justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      {!isUser && <div style={styles.aiAvatar}>◈</div>}
      <div style={{
        ...styles.bubble,
        ...(isUser ? styles.userBubble : styles.aiBubble),
      }}>
        <div style={styles.bubbleContent}>{message.content}</div>
        <div style={styles.bubbleMeta}>
          {isUser ? '🔒 encrypted on-chain' : ''}
          {message.timestamp ? ` · ${new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div style={{ ...styles.bubbleRow, justifyContent: 'flex-start' }}>
      <div style={styles.aiAvatar}>◈</div>
      <div style={{ ...styles.bubble, ...styles.aiBubble }}>
        <div style={styles.typingDots}>
          <span style={{ ...styles.dot, animationDelay: '0ms' }} />
          <span style={{ ...styles.dot, animationDelay: '200ms' }} />
          <span style={{ ...styles.dot, animationDelay: '400ms' }} />
        </div>
      </div>
    </div>
  );
}

function LandingScreen() {
  return (
    <div style={styles.landing}>
      <div style={styles.landingCard}>
        <div style={styles.landingLogo}>◈ AURA</div>
        <h1 style={styles.landingTitle}>Encrypted AI Chat on Sui</h1>
        <p style={styles.landingDesc}>
          Your conversations, encrypted client-side, stored on-chain.
          Earn points for meaningful interactions. Mint AURA tokens.
        </p>

        <ConnectButton style={styles.landingConnectBtn} />
      </div>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = {
  root: {
    display: 'flex',
    height: '100vh',
    background: '#0a0a0f',
    color: '#e8e6f0',
    fontFamily: '"IBM Plex Mono", "Courier New", monospace',
    overflow: 'hidden',
  },
  toast: {
    position: 'fixed',
    top: 20,
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
    color: '#fff',
    padding: '10px 24px',
    borderRadius: 24,
    fontSize: 13,
    fontWeight: 600,
    zIndex: 9999,
    boxShadow: '0 4px 20px rgba(124,58,237,0.4)',
    letterSpacing: '0.02em',
  },
  sidebar: {
    width: 240,
    minWidth: 240,
    background: '#0f0f1a',
    borderRight: '1px solid rgba(255,255,255,0.06)',
    display: 'flex',
    flexDirection: 'column',
    padding: '20px 16px',
    gap: 16,
    overflowY: 'auto',
  },
  sidebarLogo: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 12,
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  logoMark: { fontSize: 22, color: '#7c3aed' },
  logoText: { fontSize: 18, fontWeight: 700, letterSpacing: '0.15em', color: '#e8e6f0' },
  walletBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'rgba(255,255,255,0.04)',
    borderRadius: 8,
    padding: '8px 12px',
    border: '1px solid rgba(255,255,255,0.08)',
  },
  walletDot: {
    width: 8, height: 8, borderRadius: '50%',
    background: '#22c55e',
    boxShadow: '0 0 6px #22c55e',
  },
  walletAddr: { fontSize: 12, color: '#a0a0c0', letterSpacing: '0.05em' },
  statsBlock: {
    background: 'rgba(124,58,237,0.08)',
    border: '1px solid rgba(124,58,237,0.2)',
    borderRadius: 10,
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  statRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  statLabel: { fontSize: 11, color: '#7070a0', textTransform: 'uppercase', letterSpacing: '0.08em' },
  statValue: { fontSize: 13, fontWeight: 700, color: '#c4b5fd' },
  progressBar: {
    height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 4, overflow: 'hidden',
  },
  progressFill: {
    height: '100%', background: 'linear-gradient(90deg, #7c3aed, #4f46e5)',
    borderRadius: 4, transition: 'width 0.5s ease',
  },
  progressLabel: { fontSize: 10, color: '#5050a0', textAlign: 'right' },
  redeemBtn: {
    background: 'rgba(124,58,237,0.15)',
    border: '1px solid rgba(124,58,237,0.3)',
    borderRadius: 8,
    color: '#c4b5fd',
    padding: '10px 14px',
    fontSize: 13,
    cursor: 'pointer',
    textAlign: 'center',
    transition: 'all 0.2s',
  },
  redeemPanel: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10,
    padding: '14px',
  },
  redeemTitle: { fontSize: 12, fontWeight: 700, color: '#c4b5fd', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.1em' },
  redeemRate: { fontSize: 11, color: '#7070a0', marginBottom: 12 },
  mintRow: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 6 },
  adjBtn: {
    width: 28, height: 28, borderRadius: '50%',
    background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.4)',
    color: '#c4b5fd', fontSize: 18, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  mintAmt: { fontSize: 22, fontWeight: 700, color: '#e8e6f0', minWidth: 32, textAlign: 'center' },
  mintCost: { fontSize: 11, color: '#7070a0', textAlign: 'center', marginBottom: 10 },
  mintBtn: {
    width: '100%', padding: '10px', borderRadius: 8,
    background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
    border: 'none', color: '#fff', fontWeight: 700, fontSize: 13,
    cursor: 'pointer', letterSpacing: '0.05em',
    fontFamily: '"IBM Plex Mono", monospace',
    transition: 'opacity 0.2s',
  },
  mintError: { fontSize: 11, color: '#f87171', marginTop: 6, textAlign: 'center' },
  sidebarFooter: { marginTop: 'auto' },
  connectBtn: { width: '100%' },
  main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  setupScreen: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 20,
  },
  setupCard: {
    maxWidth: 440, width: '100%',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 16, padding: '40px 36px',
    textAlign: 'center',
  },
  setupIcon: { fontSize: 48, color: '#7c3aed', marginBottom: 16 },
  setupTitle: { fontSize: 22, fontWeight: 700, color: '#e8e6f0', marginBottom: 10, letterSpacing: '-0.02em' },
  setupDesc: { fontSize: 14, color: '#7070a0', lineHeight: 1.6, marginBottom: 24 },
  setupFeatures: { textAlign: 'left', marginBottom: 28, display: 'flex', flexDirection: 'column', gap: 8 },
  featureItem: { fontSize: 13, color: '#a0a0c0', display: 'flex', alignItems: 'center', gap: 8 },
  featureCheck: { color: '#22c55e', fontWeight: 700 },
  setupBtn: {
    width: '100%', padding: '14px',
    background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
    border: 'none', borderRadius: 10, color: '#fff',
    fontWeight: 700, fontSize: 15, cursor: 'pointer',
    fontFamily: '"IBM Plex Mono", monospace',
    letterSpacing: '0.05em',
  },
  chatHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '14px 24px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    background: 'rgba(255,255,255,0.02)',
  },
  headerLeft: { display: 'flex', flexDirection: 'column', gap: 2 },
  headerTitle: { fontSize: 14, fontWeight: 700, color: '#e8e6f0' },
  headerSub: { fontSize: 11, color: '#5050a0', fontFamily: 'monospace' },
  headerRight: { display: 'flex', gap: 8 },
  encBadge: {
    fontSize: 11, padding: '4px 10px', borderRadius: 20,
    background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
    color: '#86efac',
  },
  chainBadge: {
    fontSize: 11, padding: '4px 10px', borderRadius: 20,
    background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.3)',
    color: '#c4b5fd',
  },
  messages: {
    flex: 1, overflowY: 'auto', padding: '24px',
    display: 'flex', flexDirection: 'column', gap: 16,
  },
  emptyState: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', marginTop: 60 },
  emptyIcon: { fontSize: 40, color: '#3030a0', marginBottom: 16 },
  emptyText: { fontSize: 15, color: '#5050a0', marginBottom: 8 },
  emptyHint: { fontSize: 12, color: '#3030a0' },
  bubbleRow: { display: 'flex', alignItems: 'flex-end', gap: 10 },
  aiAvatar: {
    width: 32, height: 32, borderRadius: '50%',
    background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.4)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 14, color: '#a78bfa', flexShrink: 0,
  },
  bubble: {
    maxWidth: '72%', padding: '12px 16px',
    borderRadius: 14, lineHeight: 1.6,
  },
  userBubble: {
    background: 'linear-gradient(135deg, #7c3aed22, #4f46e522)',
    border: '1px solid rgba(124,58,237,0.25)',
    borderBottomRightRadius: 4,
  },
  aiBubble: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderBottomLeftRadius: 4,
  },
  bubbleContent: { fontSize: 14, color: '#e8e6f0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  bubbleMeta: { fontSize: 10, color: '#4040a0', marginTop: 6 },
  typingDots: { display: 'flex', gap: 4, alignItems: 'center', height: 20 },
  dot: {
    width: 6, height: 6, borderRadius: '50%',
    background: '#6060c0',
    animation: 'pulse 1.2s ease-in-out infinite',
  },
  errorBanner: {
    background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
    color: '#fca5a5', fontSize: 13, padding: '10px 24px', textAlign: 'center',
  },
  inputArea: {
    display: 'flex', gap: 10, padding: '16px 24px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    background: 'rgba(255,255,255,0.02)',
  },
  input: {
    flex: 1, background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
    color: '#e8e6f0', fontSize: 14, padding: '12px 16px',
    fontFamily: '"IBM Plex Mono", monospace',
    outline: 'none',
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 10,
    background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
    border: 'none', color: '#fff', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  landing: {
    height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#0a0a0f',
  },
  landingCard: {
    maxWidth: 400, textAlign: 'center', padding: 40,
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20,
  },
  landingLogo: { fontSize: 28, fontWeight: 700, color: '#7c3aed', marginBottom: 20, letterSpacing: '0.1em' },
  landingTitle: { fontSize: 24, fontWeight: 700, color: '#e8e6f0', marginBottom: 12, letterSpacing: '-0.02em' },
  landingDesc: { fontSize: 14, color: '#7070a0', lineHeight: 1.6, marginBottom: 28 },
  landingConnectBtn: {},
};
