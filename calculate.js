/*
 * Copyright (c) 2026 Patrik Bukovský @ Lilliandris
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

'use strict';

// Tu bude raz žiť skutočná herná logika: ktoré kombinácie prísad pridávajú a ktoré
// uberajú čas (a o koľko). Kým ju nepoznáme, každé nahratie - bez ohľadu na to,
// ktoré a koľko prísad bolo vybraných - jednoducho pridá účastníkovi 1 minútu.
//
// Vstup:  ingredientIndexes - pole indexov vybraných prísad (z config.INGREDIENTS)
// Výstup: zmena času v milisekundách (kladné číslo = pridá čas, záporné = uberie)
function calculateDelta(ingredientIndexes) {
  return 60 * 1000;
}

module.exports = { calculateDelta };
