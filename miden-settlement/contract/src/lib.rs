// BARTOK settlement note — increment 1: split the escrowed budget into a payment
// to the seller and a refund to the buyer, as two P2ID output notes.
// (Increment 2 adds RPO Falcon-512 verification of an oracle signature.)
#![no_std]
#![feature(alloc_error_handler)]

#[macro_use]
extern crate alloc;

use miden::*;

#[note]
struct BartokSettlement;

#[note]
impl BartokSettlement {
    /// Note storage layout (read via `active_note::get_storage()`):
    /// [0..3]   P2ID note script root (Word) — passed in so we don't hardcode a version-specific digest
    /// [4]      faucet account id suffix
    /// [5]      faucet account id prefix
    /// [6]      charge (amount paid to the seller)
    /// [7]      seller account id suffix
    /// [8]      seller account id prefix
    /// [9]      seller P2ID tag
    /// [10..13] seller P2ID serial number
    /// [14]     buyer account id suffix
    /// [15]     buyer account id prefix
    /// [16]     buyer P2ID tag
    /// [17..20] buyer P2ID serial number
    /// [21]     note_type (1 = public, 2 = private) for the output notes
    ///
    /// NOTE: on-chain oracle gating (verify a Falcon attestation before paying) is deferred.
    /// Miden 0.14's falcon-sig mechanism only signs the transaction summary, not a standalone
    /// commitment, so gating will be done by restricting the settlement tx to the oracle account.
    #[note_script]
    fn run(self, _arg: Word) {
        let s = active_note::get_storage();

        let p2id_root = Word::from([s[0], s[1], s[2], s[3]]);
        let charge = s[6];
        let seller = AccountId::new(s[8], s[7]);
        let seller_tag = Tag::from(s[9]);
        let seller_serial = Word::from([s[10], s[11], s[12], s[13]]);
        let buyer = AccountId::new(s[15], s[14]);
        let buyer_tag = Tag::from(s[16]);
        let buyer_serial = Word::from([s[17], s[18], s[19], s[20]]);
        let note_type = NoteType::from(s[21]);

        // Budget = the escrowed fungible asset amount.
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

        // Pay the seller `charge` via a P2ID output note.
        let pay_asset = Asset::new(key, Word::from([charge, val[1], val[2], val[3]]));
        let seller_recipient =
            note::build_recipient(seller_serial, p2id_root, vec![seller.suffix, seller.prefix]);
        let seller_idx = output_note::create(seller_tag, note_type, seller_recipient);
        output_note::add_asset(pay_asset, seller_idx);

        // Refund the buyer the remainder via a P2ID output note.
        let refund_asset = Asset::new(key, Word::from([refund, val[1], val[2], val[3]]));
        let buyer_recipient =
            note::build_recipient(buyer_serial, p2id_root, vec![buyer.suffix, buyer.prefix]);
        let buyer_idx = output_note::create(buyer_tag, note_type, buyer_recipient);
        output_note::add_asset(refund_asset, buyer_idx);
    }
}
