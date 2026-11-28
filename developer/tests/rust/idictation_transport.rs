use super::*;
use std::collections::BTreeSet;

#[test]
fn host_and_product_allow_exactly_the_same_operations() {
    let allowed = BRIDGE
        .split_once("const allowed = {")
        .unwrap()
        .1
        .split_once("\n  }")
        .unwrap()
        .0
        .lines()
        .filter_map(|line| line.trim().split_once(':').map(|(name, _)| name))
        .collect::<BTreeSet<_>>();
    let host: BTreeSet<_> = OPERATIONS.iter().copied().collect();
    assert_eq!(
        host, allowed,
        "a bridge-only operation cannot reach the real WebView"
    );
}
