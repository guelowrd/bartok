// TEMP canary: kernel commitment must match the live network's proof commitment
fn main() {
    use miden_client::transaction::TransactionKernel;
    let w = TransactionKernel.to_commitment();
    println!("kernel: {}", w.to_hex());
    assert_eq!(w.to_hex(), "0x8cd42f3f2c023c2632ceb982f3d3cf2952f5a1655915c9525a04b510c53fbd20");
    println!("KERNEL CANARY OK");
}
