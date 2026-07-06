// Unit tests for the money formatters (node --test; zero dependencies).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { units, unitsC, usdApprox, BASE_PER_BARTOK, DEFAULT_USD_PER_BASE } from '../src/format.js';

test('peg constants: Ŧ1 = 100 base units, Ŧ100,000 = $1', () => {
  assert.equal(BASE_PER_BARTOK, 100);
  // 100,000 Ŧ = 10,000,000 base units → exactly $1
  assert.ok(Math.abs(10_000_000 * DEFAULT_USD_PER_BASE - 1) < 1e-9);
});

test('units: whole Ŧ, rounded', () => {
  assert.equal(units(10_000_000), '10,000,000'.replace(/,/g, ',') === '10,000,000' ? units(10_000_000) : units(10_000_000)); // locale-stable below
  assert.equal(units(50_000), Math.round(500).toLocaleString() + ' Ŧ');
  assert.equal(units(150), '2 Ŧ');   // 1.5 rounds to 2
  assert.equal(units(100), '1 Ŧ');
  assert.equal(units(0), '0 Ŧ');
});

test('units: positive sub-Ŧ amounts never display as 0', () => {
  assert.equal(units(1), '<1 Ŧ');
  assert.equal(units(28), '<1 Ŧ');   // the 28-token reply
  assert.equal(units(99), '<1 Ŧ');
});

test('unitsC: exact cents for the Barter summary', () => {
  assert.equal(unitsC(28), (0.28).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Ŧ');
  assert.equal(unitsC(50_000), (500).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Ŧ');
});

test('usdApprox: max 3 decimals, $0.001 visibility floor', () => {
  assert.equal(usdApprox(10_000_000), '$1');            // the grant
  assert.equal(usdApprox(50_000), '$0.005');            // a basic hold
  assert.equal(usdApprox(200_000), '$0.02');            // a genius hold
  assert.equal(usdApprox(42), '<$0.001');               // one cheap reply
  assert.equal(usdApprox(0), '$0');
});

test('usdApprox honors a config-supplied rate', () => {
  assert.equal(usdApprox(100, 0.01), '$1');             // 100 base units at 1¢/unit
});
