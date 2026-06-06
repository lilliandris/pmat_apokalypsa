'use strict';

// Zoznam 25 prísad, z ktorých vedúci vyberajú kombináciu, ktorú im účastník odovzdal.
// Skutočná logika výpočtu (ktoré kombinácie pridávajú/uberajú čas) zatiaľ nie je známa,
// preto calculate.js zatiaľ vracia jednotnú hodnotu pre akýkoľvek výber - viď calculate.js.
const INGREDIENTS = [
  'Dračia šupina',
  'Mesačný prach',
  'Slzy fénixa',
  'Koreň mandragory',
  'Krídlo motýľa',
  'Perla z hlbín',
  'Popol zo sviečky',
  'Kvapka rosy',
  'Vločka z ľadovca',
  'Lístok ďateliny',
  'Pavučina',
  'Plameň sviečky',
  'Žihľava',
  'Med divej včely',
  'Škrupina orecha',
  'Kamienok z rieky',
  'Pierko sovy',
  'Soľ zo studne',
  'Semienko slnečnice',
  'Hlina z hrobu',
  'Vosk zo sviečky',
  'Šúpolie kukurice',
  'Iskra kresadla',
  'Tieň netopiera',
  'Zrnko piesku',
];

// Minimálny odstup medzi dvoma nahratiami pre toho istého účastníka (v milisekundách).
const SUBMISSION_COOLDOWN_MS = 60 * 1000;

// Predvolený štartovací čas (v minútach), ktorý dostane každé nové dieťa pridané do hry.
// Dá sa zmeniť v admin paneli (ovplyvní len novo pridaných účastníkov).
const DEFAULT_STARTING_MINUTES = 60;

const SESSION_SECRET = process.env.SESSION_SECRET || 'apocalypse-sustredenie-tajny-kluc';

module.exports = {
  INGREDIENTS,
  SUBMISSION_COOLDOWN_MS,
  DEFAULT_STARTING_MINUTES,
  SESSION_SECRET,
};
