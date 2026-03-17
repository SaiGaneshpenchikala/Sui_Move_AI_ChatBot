module sui_ai_chat::points {

    use std::string::{Self, String};
    use std::vector;
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::event;
    use sui::clock::{Self, Clock};

    const ENotAuthorized: u64 = 0;
    const EInsufficientPoints: u64 = 1;
    const EInvalidAmount: u64 = 3;
    const EAlreadyHasTheme: u64 = 4;

    const BASE_POINTS_PER_MESSAGE: u64 = 10;
    const MAX_QUALITY_BONUS: u64 = 50;
    const DAILY_CAP: u64 = 500;

    const MS_PER_DAY: u64 = 86400000;

    const STREAK_MULT_0: u64 = 100;
    const STREAK_MULT_1: u64 = 150;
    const STREAK_MULT_2: u64 = 200;
    const STREAK_MULT_3PLUS: u64 = 300;

    const THEME_UNLOCK_COST: u64 = 200;

    public struct PointsAdminCap has key, store {
        id: UID
    }

    public struct PointsAccount has key {
        id: UID,
        owner: address,
        balance: u64,
        total_earned: u64,
        total_burned: u64,
        points_today: u64,
        day_window_start_ms: u64,
        streak_days: u64,
        last_active_day: u64,
        earn_history: vector<EarnRecord>,
        unlocked_themes: vector<String>,
        recent_message_times: vector<u64>,
    }

    public struct EarnRecord has store, drop {
        amount: u64,
        reason: String,
        timestamp_ms: u64,
    }

    public struct PointsEarned has copy, drop {
        account: address,
        amount: u64,
        reason: String,
        new_balance: u64,
        timestamp_ms: u64,
    }

    public struct PointsBurned has copy, drop {
        account: address,
        amount: u64,
        reason: String,
        new_balance: u64,
        timestamp_ms: u64,
    }

    public struct ThemeUnlocked has copy, drop {
        account: address,
        theme_id: String,
        timestamp_ms: u64,
    }

    fun init(ctx: &mut TxContext) {
        transfer::transfer(
            PointsAdminCap { id: object::new(ctx) },
            tx_context::sender(ctx),
        );
    }

    public entry fun create_account(clock: &Clock, ctx: &mut TxContext) {
        let now = clock::timestamp_ms(clock);

        let account = PointsAccount {
            id: object::new(ctx),
            owner: tx_context::sender(ctx),
            balance: 0,
            total_earned: 0,
            total_burned: 0,
            points_today: 0,
            day_window_start_ms: now,
            streak_days: 0,
            last_active_day: ms_to_day(now),
            earn_history: vector::empty(),
            unlocked_themes: vector::empty(),
            recent_message_times: vector::empty(),
        };

        transfer::transfer(account, tx_context::sender(ctx));
    }

    public entry fun award_points(
        _cap: &PointsAdminCap,
        account: &mut PointsAccount,
        quality_bonus: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {

        let now = clock::timestamp_ms(clock);

        let cutoff = if (now > 60000) { now - 60000 } else { 0 };

        prune_recent_messages(&mut account.recent_message_times, cutoff);

        if (vector::length(&account.recent_message_times) >= 10) {
            vector::push_back(&mut account.recent_message_times, now);
            let _ = ctx;
            return
        };

        vector::push_back(&mut account.recent_message_times, now);

        refresh_day_window(account, now);

        let bonus =
            if (quality_bonus > MAX_QUALITY_BONUS) {
                MAX_QUALITY_BONUS
            } else {
                quality_bonus
            };

        let streak_mult = get_streak_mult(account.streak_days);

        let raw = BASE_POINTS_PER_MESSAGE + bonus;

        let earned = (raw * streak_mult) / 100;

        let remaining_today =
            if (account.points_today >= DAILY_CAP) {
                0
            } else {
                DAILY_CAP - account.points_today
            };

        let actual =
            if (earned > remaining_today) {
                remaining_today
            } else {
                earned
            };

        if (actual == 0) {
            let _ = ctx;
            return
        };

        account.balance = account.balance + actual;
        account.total_earned = account.total_earned + actual;
        account.points_today = account.points_today + actual;

        let today = ms_to_day(now);

        if (today > account.last_active_day) {

            let diff = today - account.last_active_day;

            if (diff == 1) {
                account.streak_days = account.streak_days + 1;
            } else {
                account.streak_days = 1;
            };

            account.last_active_day = today;
        };

        let rec = EarnRecord {
            amount: actual,
            reason: string::utf8(b"message_interaction"),
            timestamp_ms: now
        };

        vector::push_back(&mut account.earn_history, rec);

        if (vector::length(&account.earn_history) > 50) {
            vector::remove(&mut account.earn_history, 0);
        };

        event::emit(PointsEarned {
            account: account.owner,
            amount: actual,
            reason: string::utf8(b"message_interaction"),
            new_balance: account.balance,
            timestamp_ms: now,
        });

        let _ = ctx;
    }

    public fun burn_for_tokens(
        account: &mut PointsAccount,
        amount: u64,
        clock: &Clock
    ): u64 {

        assert!(amount > 0, EInvalidAmount);
        assert!(account.balance >= amount, EInsufficientPoints);

        account.balance = account.balance - amount;
        account.total_burned = account.total_burned + amount;

        event::emit(PointsBurned {
            account: account.owner,
            amount,
            reason: string::utf8(b"token_mint"),
            new_balance: account.balance,
            timestamp_ms: clock::timestamp_ms(clock),
        });

        amount
    }

    public entry fun unlock_theme(
        account: &mut PointsAccount,
        theme_id: String,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {

        assert!(tx_context::sender(ctx) == account.owner, ENotAuthorized);

        let len = vector::length(&account.unlocked_themes);

        let mut i: u64 = 0;
        let mut found = false;

        while (i < len) {

            if (*vector::borrow(&account.unlocked_themes, i) == theme_id) {
                found = true;
            };

            i = i + 1;
        };

        assert!(!found, EAlreadyHasTheme);
        assert!(account.balance >= THEME_UNLOCK_COST, EInsufficientPoints);

        account.balance = account.balance - THEME_UNLOCK_COST;
        account.total_burned = account.total_burned + THEME_UNLOCK_COST;

        vector::push_back(&mut account.unlocked_themes, theme_id);

        event::emit(ThemeUnlocked {
            account: account.owner,
            theme_id,
            timestamp_ms: clock::timestamp_ms(clock),
        });
    }

    public fun get_balance(account: &PointsAccount): u64 {
        account.balance
    }

    public fun has_theme(account: &PointsAccount, theme_id: &String): bool {

        let len = vector::length(&account.unlocked_themes);

        let mut i: u64 = 0;

        while (i < len) {

            if (vector::borrow(&account.unlocked_themes, i) == theme_id) {
                return true
            };

            i = i + 1;
        };

        false
    }

    fun ms_to_day(ms: u64): u64 {
        ms / MS_PER_DAY
    }

    fun refresh_day_window(account: &mut PointsAccount, now: u64) {

        if (now >= account.day_window_start_ms + MS_PER_DAY) {

            account.points_today = 0;

            account.day_window_start_ms =
                (now / MS_PER_DAY) * MS_PER_DAY;
        };
    }

    fun get_streak_mult(streak: u64): u64 {

        if (streak == 0) {
            STREAK_MULT_0
        } else if (streak == 1) {
            STREAK_MULT_1
        } else if (streak == 2) {
            STREAK_MULT_2
        } else {
            STREAK_MULT_3PLUS
        }
    }

    fun prune_recent_messages(times: &mut vector<u64>, cutoff: u64) {

        let mut i: u64 = 0;

        while (i < vector::length(times)) {

            if (*vector::borrow(times, i) < cutoff) {
                vector::remove(times, i);
            } else {
                i = i + 1;
            };
        };
    }

}