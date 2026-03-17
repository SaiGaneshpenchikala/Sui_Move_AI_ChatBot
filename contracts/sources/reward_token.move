/// sui_ai_chat::reward_token
///
/// AURA — the AI Chat reward token.
/// - Created via coin::create_currency (one-time witness pattern)
/// - Only the AI service (MintCap holder) can mint
/// - Minting atomically burns the user's points in the same transaction
/// - Configurable max supply (enforced on-chain)
/// - Users can burn tokens for future utility
module sui_ai_chat::reward_token {
    use std::option;
    use std::string;
    use sui::coin::{Self, Coin, TreasuryCap, CoinMetadata};
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::event;
    use sui::clock::{Self, Clock};
    use sui::url;
    use sui_ai_chat::points::{Self, PointsAccount};

    // ===== Error codes =====
    const EMaxSupplyExceeded: u64 = 0;
    const EInsufficientPoints: u64 = 1;
    const EInvalidAmount: u64 = 2;
    const ENotAuthorized: u64 = 3;

    // ===== Constants =====
    // 100M AURA max supply (9 decimals)
    const MAX_SUPPLY: u64 = 100_000_000_000_000_000;
    // Exchange rate: 100 points = 1 AURA (1_000_000_000 base units)
    const POINTS_PER_TOKEN: u64 = 100;
    const TOKEN_DECIMALS: u8 = 9;
    const TOKEN_BASE_UNIT: u64 = 1_000_000_000;

    // ===== One-time witness =====
    public struct REWARD_TOKEN has drop {}

    // ===== Structs =====

    /// Mint capability — held by the AI backend service address.
    /// Only this cap can call mint_tokens.
    public struct MintCap has key, store {
        id: UID,
        minted_total: u64,
    }

    /// Config object — holds max supply and current minted amount.
    public struct TokenConfig has key {
        id: UID,
        max_supply: u64,
        total_minted: u64,
        total_burned: u64,
    }

    // ===== Events =====

    public struct TokensMinted has copy, drop {
        recipient: address,
        amount: u64,
        points_burned: u64,
        timestamp_ms: u64,
    }

    public struct TokensBurned has copy, drop {
        account: address,
        amount: u64,
        timestamp_ms: u64,
    }

    // ===== Init =====

    fun init(witness: REWARD_TOKEN, ctx: &mut TxContext) {
        let (treasury_cap, metadata) = coin::create_currency(
            witness,
            TOKEN_DECIMALS,
            b"AURA",
            b"AURA",
            b"AI Chat Reward Token - earned through meaningful conversations",
            option::some(url::new_unsafe_from_bytes(b"https://sui-ai-chat.example.com/aura.png")),
            ctx,
        );

        let config = TokenConfig {
            id: object::new(ctx),
            max_supply: MAX_SUPPLY,
            total_minted: 0,
            total_burned: 0,
        };

        let mint_cap = MintCap {
            id: object::new(ctx),
            minted_total: 0,
        };

        // Freeze metadata so it can't be changed
        transfer::public_freeze_object(metadata);
        // Share config so anyone can read it
        transfer::share_object(config);
        // Send treasury cap and mint cap to deployer (deployer then transfers to AI service)
        transfer::public_transfer(treasury_cap, tx_context::sender(ctx));
        transfer::transfer(mint_cap, tx_context::sender(ctx));
    }

    // ===== Public entry functions =====

    /// Transfer MintCap to the AI service address (called by deployer once).
    public entry fun transfer_mint_cap(
        cap: MintCap,
        recipient: address,
        _ctx: &mut TxContext,
    ) {
        transfer::transfer(cap, recipient);
    }

    /// Mint AURA tokens — atomically burns user's points in the same tx.
    /// token_amount: number of whole AURA tokens to mint (not base units).
    /// The required points = token_amount * POINTS_PER_TOKEN.
    public entry fun mint_tokens(
        mint_cap: &mut MintCap,
        treasury_cap: &mut TreasuryCap<REWARD_TOKEN>,
        config: &mut TokenConfig,
        points_account: &mut PointsAccount,
        token_amount: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(token_amount > 0, EInvalidAmount);

        let base_units = token_amount * TOKEN_BASE_UNIT;
        let points_required = token_amount * POINTS_PER_TOKEN;

        // Enforce max supply
        assert!(
            config.total_minted + base_units <= config.max_supply,
            EMaxSupplyExceeded,
        );

        // Atomically burn points (this asserts balance >= required)
        let burned = points::burn_for_tokens(points_account, points_required, clock);
        assert!(burned == points_required, EInsufficientPoints);

        // Mint the coin
        let coin = coin::mint(treasury_cap, base_units, ctx);
        let recipient = tx_context::sender(ctx);

        config.total_minted = config.total_minted + base_units;
        mint_cap.minted_total = mint_cap.minted_total + base_units;

        event::emit(TokensMinted {
            recipient,
            amount: base_units,
            points_burned: points_required,
            timestamp_ms: clock::timestamp_ms(clock),
        });

        transfer::public_transfer(coin, recipient);
    }

    /// User burns AURA tokens (for future utility — placeholder).
    public entry fun burn_tokens(
        treasury_cap: &mut TreasuryCap<REWARD_TOKEN>,
        config: &mut TokenConfig,
        coin_in: Coin<REWARD_TOKEN>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let amount = coin::value(&coin_in);
        config.total_burned = config.total_burned + amount;

        event::emit(TokensBurned {
            account: tx_context::sender(ctx),
            amount,
            timestamp_ms: clock::timestamp_ms(clock),
        });

        coin::burn(treasury_cap, coin_in);
    }

    // ===== Read functions =====

    public fun get_total_minted(config: &TokenConfig): u64 { config.total_minted }
    public fun get_total_burned(config: &TokenConfig): u64 { config.total_burned }
    public fun get_max_supply(config: &TokenConfig): u64 { config.max_supply }
    public fun get_circulating(config: &TokenConfig): u64 {
        config.total_minted - config.total_burned
    }
    public fun get_points_per_token(): u64 { POINTS_PER_TOKEN }
}
