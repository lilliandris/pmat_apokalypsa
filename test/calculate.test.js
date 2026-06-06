'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { calculateDelta } = require('../calculate');

test('calculateDelta vráti kladnú zmenu času (pridanie 1 minúty)', () => {
  assert.strictEqual(calculateDelta([0]), 60 * 1000);
});

test('calculateDelta zatiaľ ignoruje konkrétny výber prísad', () => {
  // Skutočná herná logika ešte nie je známa - kým sa nedoplní, calculateDelta vracia
  // rovnakú hodnotu bez ohľadu na to, ktoré ani koľko prísad bolo vybraných.
  assert.strictEqual(calculateDelta([0, 1, 2]), calculateDelta([5]));
  assert.strictEqual(calculateDelta([]), calculateDelta([3, 7, 11]));
});
