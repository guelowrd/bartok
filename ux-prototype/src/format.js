// BarŦok display formatting. Single source of truth, unit-tested (test/format.test.mjs).
//
// Money model: the BART faucet has decimals = 2 — 1 BASE unit = 1 Basic LLM
// token, Ŧ1.00 = 100 base units. Display policy: whole Ŧ everywhere, Ŧ as a
// PREFIX ('<Ŧ1' for small positive amounts); exact cents only on the Barter summary.
// Dollar approximations: ≈$ with at most 3 decimals; anything smaller than
// $0.001 shows as '<$0.001'.

export const BASE_PER_BARTOK = 100;
export const DEFAULT_USD_PER_BASE = 0.00001 / BASE_PER_BARTOK; // Ŧ1 = $0.00001 → per base unit

/** Whole-Ŧ display (all surfaces except the settle receipt). Ŧ is a prefix. */
export const units = (baseUnits) => {
  const raw = Number(baseUnits);
  if (raw > 0 && raw < BASE_PER_BARTOK) return '<Ŧ1';
  return 'Ŧ' + Math.round(raw / BASE_PER_BARTOK).toLocaleString();
};

/** Exact-cents display (the Barter summary only). Ŧ is a prefix. */
export const unitsC = (baseUnits) =>
  'Ŧ' + (Number(baseUnits) / BASE_PER_BARTOK).toLocaleString(undefined, {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });

/** Dollar approximation: max 3 decimals, floor of visibility $0.001. */
export const usdApprox = (baseUnits, usdPerBase = DEFAULT_USD_PER_BASE) => {
  const v = Number(baseUnits) * usdPerBase;
  if (v <= 0) return '$0';
  if (v < 0.001) return '<$0.001';
  return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 3 });
};
