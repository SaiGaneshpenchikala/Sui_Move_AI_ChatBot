/// sui_ai_chat::conversation
/// 
/// Stores encrypted conversation messages as Sui objects owned by the user.
/// Uses capability pattern: only an authorized AIServiceCap holder can write
/// new message entries. Users can revoke access at any time.
module sui_ai_chat::conversation {
    use std::string::{Self, String};
    use std::vector;
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::event;
    use sui::clock::{Self, Clock};

    // ===== Error codes =====
    const ENotAuthorized: u64 = 0;
    const EAccessRevoked: u64 = 1;
    const EEmptyMessage: u64 = 2;
    const EConversationFull: u64 = 3;
    const ENotOwner: u64 = 4;

    // ===== Constants =====
    const MAX_MESSAGES_PER_CONVERSATION: u64 = 500;
    // AES-256-GCM ciphertext is typically larger; we cap blob size at 8KB
    const MAX_CIPHERTEXT_BYTES: u64 = 8192;

    // ===== Structs =====

    /// Admin capability — held by the protocol deployer.
    /// Used to issue AIServiceCap tokens to authorized AI backends.
    public struct AdminCap has key, store {
        id: UID,
    }

    /// AI service write-access capability.
    /// The AI backend holds this to write messages. Users can revoke it
    /// by calling revoke_service_access, which destroys this object.
    public struct AIServiceCap has key, store {
        id: UID,
        /// The conversation this cap grants write access to.
        conversation_id: address,
        /// Issuing authority (admin address at time of issuance).
        issued_by: address,
    }

    /// A single encrypted message in the conversation.
    /// ciphertext: AES-256-GCM encrypted JSON blob (base64-encoded on-chain)
    /// iv: 12-byte initialization vector (base64)
    /// role: "user" | "assistant"
    public struct Message has store, drop {
        role: String,
        ciphertext: vector<u8>,
        iv: vector<u8>,
        timestamp_ms: u64,
        message_index: u64,
    }

    /// The main conversation object — owned by the user's wallet.
    public struct Conversation has key {
        id: UID,
        owner: address,
        messages: vector<Message>,
        /// True while AIServiceCap for this conversation is live
        service_access_active: bool,
        /// Total messages ever appended (monotonic counter)
        total_messages: u64,
        created_at_ms: u64,
        last_updated_ms: u64,
        /// Encrypted symmetric key (wrapped with user's public key)
        encrypted_key: vector<u8>,
    }

    // ===== Events =====

    public struct ConversationCreated has copy, drop {
        conversation_id: address,
        owner: address,
        timestamp_ms: u64,
    }

    public struct MessageAppended has copy, drop {
        conversation_id: address,
        message_index: u64,
        role: String,
        timestamp_ms: u64,
    }

    public struct AccessRevoked has copy, drop {
        conversation_id: address,
        owner: address,
        timestamp_ms: u64,
    }

    // ===== Init =====

    fun init(ctx: &mut TxContext) {
        let admin_cap = AdminCap { id: object::new(ctx) };
        transfer::transfer(admin_cap, tx_context::sender(ctx));
    }

    // ===== Public entry functions =====

    /// User creates a new conversation. They receive the Conversation object
    /// and a capability is issued to the AI service backend.
    public entry fun create_conversation(
        encrypted_key: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let sender = tx_context::sender(ctx);
        let now = clock::timestamp_ms(clock);
        let conv_uid = object::new(ctx);
        let conv_id = object::uid_to_address(&conv_uid);

        let conversation = Conversation {
            id: conv_uid,
            owner: sender,
            messages: vector::empty(),
            service_access_active: true,
            total_messages: 0,
            created_at_ms: now,
            last_updated_ms: now,
            encrypted_key,
        };

        event::emit(ConversationCreated {
            conversation_id: conv_id,
            owner: sender,
            timestamp_ms: now,
        });

        transfer::transfer(conversation, sender);
    }

    /// Admin issues an AIServiceCap for a conversation to the AI backend.
    public entry fun issue_service_cap(
        _admin: &AdminCap,
        conversation_id: address,
        ai_service_address: address,
        ctx: &mut TxContext,
    ) {
        let cap = AIServiceCap {
            id: object::new(ctx),
            conversation_id,
            issued_by: tx_context::sender(ctx),
        };
        transfer::transfer(cap, ai_service_address);
    }

    /// AI service appends an encrypted message to the conversation.
    /// Only callable by the holder of the matching AIServiceCap.
    public entry fun append_message(
        cap: &AIServiceCap,
        conversation: &mut Conversation,
        role: String,
        ciphertext: vector<u8>,
        iv: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let conv_id = object::uid_to_address(&conversation.id);
        assert!(cap.conversation_id == conv_id, ENotAuthorized);
        assert!(conversation.service_access_active, EAccessRevoked);
        assert!(!vector::is_empty(&ciphertext), EEmptyMessage);
        assert!(vector::length(&ciphertext) <= MAX_CIPHERTEXT_BYTES, EEmptyMessage);
        assert!(conversation.total_messages < MAX_MESSAGES_PER_CONVERSATION, EConversationFull);

        let now = clock::timestamp_ms(clock);
        let idx = conversation.total_messages;

        let msg = Message {
            role,
            ciphertext,
            iv,
            timestamp_ms: now,
            message_index: idx,
        };

        vector::push_back(&mut conversation.messages, msg);
        conversation.total_messages = idx + 1;
        conversation.last_updated_ms = now;

        event::emit(MessageAppended {
            conversation_id: conv_id,
            message_index: idx,
            role,
            timestamp_ms: now,
        });

        // suppress unused variable warning
        let _ = ctx;
    }

    /// User revokes the AI service's write access. The AIServiceCap is
    /// destroyed so it can never be used again for this conversation.
    public entry fun revoke_service_access(
        cap: AIServiceCap,
        conversation: &mut Conversation,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let conv_id = object::uid_to_address(&conversation.id);
        assert!(cap.conversation_id == conv_id, ENotAuthorized);
        // Only the conversation owner can revoke
        assert!(tx_context::sender(ctx) == conversation.owner, ENotOwner);

        let AIServiceCap { id, conversation_id: _, issued_by: _ } = cap;
        object::delete(id);

        conversation.service_access_active = false;
        conversation.last_updated_ms = clock::timestamp_ms(clock);

        event::emit(AccessRevoked {
            conversation_id: conv_id,
            owner: conversation.owner,
            timestamp_ms: clock::timestamp_ms(clock),
        });
    }

    /// User exports their encrypted conversation (returns all ciphertexts).
    /// This is a read-only view — no state mutation needed.
    public fun get_message_count(conversation: &Conversation): u64 {
        conversation.total_messages
    }

    public fun get_message(conversation: &Conversation, index: u64): (String, vector<u8>, vector<u8>, u64) {
        let msg = vector::borrow(&conversation.messages, index);
        (msg.role, msg.ciphertext, msg.iv, msg.timestamp_ms)
    }

    public fun is_service_active(conversation: &Conversation): bool {
        conversation.service_access_active
    }

    public fun get_encrypted_key(conversation: &Conversation): vector<u8> {
        conversation.encrypted_key
    }

    public fun get_owner(conversation: &Conversation): address {
        conversation.owner
    }
}
