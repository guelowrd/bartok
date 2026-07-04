// BARTOK settlement note — split the escrowed budget into a payment to the
// seller and a refund to the buyer, as two P2ID output notes.
//
// The charge is passed as the note ARG at consumption time (arg[0]) because a
// session's total charge is only known when the buyer ends the session; the
// note itself is created at session start, escrowing the budget.
//
// The P2ID recipients are PRECOMPUTED by the note creator and passed in note
// storage (the creator already knows target ids, serials, and the P2ID script
// root). This keeps the script allocation-free and avoids the midenc 0.9
// operand-mangling bug in `note::build_recipient` when called from a
// note-script context. Trust-wise this is equivalent to deriving recipients
// on-chain from creator-supplied ids: either way the escrow creator picks the
// payees, and the operator validates the escrow off-chain before serving.
// On-chain oracle gating (verify an oracle attestation before paying) remains
// deferred: the note trusts the executor-supplied charge. See ARCHITECTURE.md.
#![no_std]
#![feature(alloc_error_handler)]

use miden::*;

/// Note storage layout: 11 felts, deserialized into these fields in
/// declaration order by the `#[note]` macro. Keep in sync with the
/// NoteStorage construction in integration tests, bins, and the browser
/// wallet (ux-prototype/src/wallet.js).
#[note]
struct BartokSettlement {
    seller_recipient_0: Felt,
    seller_recipient_1: Felt,
    seller_recipient_2: Felt,
    seller_recipient_3: Felt,
    seller_tag: Felt,
    buyer_recipient_0: Felt,
    buyer_recipient_1: Felt,
    buyer_recipient_2: Felt,
    buyer_recipient_3: Felt,
    buyer_tag: Felt,
    note_type: Felt,
}

#[note]
impl BartokSettlement {
    #[note_script]
    fn run(self, arg: Word) {
        let charge = arg[0];
        let note_type = NoteType::from(self.note_type);

        // Budget = the escrowed fungible asset amount ([amount, 0, 0, 0] layout).
        let mut assets = active_note::get_assets();
        let escrow = assets.pop().unwrap();
        let key = escrow.key;
        let val = escrow.value;
        let budget = val[0];

        // Guard before subtracting (felt subtraction wraps the field modulus).
        assert!(
            budget.as_canonical_u64() >= charge.as_canonical_u64(),
            "charge exceeds escrowed budget"
        );
        let refund = budget - charge;

        // Pay the seller `charge` via a P2ID output note (skip if zero).
        if charge.as_canonical_u64() > 0 {
            let seller_recipient = Recipient::from(Word::from([
                self.seller_recipient_0,
                self.seller_recipient_1,
                self.seller_recipient_2,
                self.seller_recipient_3,
            ]));
            let seller_idx =
                output_note::create(Tag::from(self.seller_tag), note_type, seller_recipient);
            let pay_asset = Asset::new(key, Word::from([charge, val[1], val[2], val[3]]));
            output_note::add_asset(pay_asset, seller_idx);
        }

        // Refund the buyer the remainder via a P2ID output note (skip if zero).
        if refund.as_canonical_u64() > 0 {
            let buyer_recipient = Recipient::from(Word::from([
                self.buyer_recipient_0,
                self.buyer_recipient_1,
                self.buyer_recipient_2,
                self.buyer_recipient_3,
            ]));
            let buyer_idx =
                output_note::create(Tag::from(self.buyer_tag), note_type, buyer_recipient);
            let refund_asset = Asset::new(key, Word::from([refund, val[1], val[2], val[3]]));
            output_note::add_asset(refund_asset, buyer_idx);
        }
    }
}
