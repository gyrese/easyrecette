/**
 * Tests du module d'unités.
 *
 * Ce module porte deux règles produit qu'il serait facile de casser en le
 * modifiant : une quantité inconnue reste inconnue après mise à l'échelle,
 * et deux unités incompatibles ne fusionnent jamais. Les cas ci-dessous
 * reprennent les exemples du cahier des charges (§11, §12).
 *
 * Volontairement sans framework : --- fusion ---
OK   500g + 700g                                    {"quantity":1.2,"unit":"kg"}
OK   2 + 1 (sans unite)                             {"quantity":3,"unit":null}
OK   200g + 4 pieces -> refus                       null
OK   1 kg + 500 g                                   {"quantity":1.5,"unit":"kg"}
OK   25 cl + 25 cl                                  {"quantity":50,"unit":"cl"}
OK   2 cas + 1 cas                                  {"quantity":3,"unit":"c. à soupe"}
OK   null + 2 => null (jamais invente)              {"quantity":null,"unit":null}

--- portions dynamiques (§11) ---
OK   500g pour 4 -> 8 pers = 1kg                    {"quantity":1,"unit":"kg"}
OK   4 filets pour 4 -> 8 pers                      {"quantity":8,"unit":null}
OK   150g pour 4 -> 6 pers                          {"quantity":225,"unit":"g"}
OK   null reste null apres scaling                  {"quantity":null,"unit":"g"}
OK   2 cas pour 4 -> 2 pers                         {"quantity":1,"unit":"c. à soupe"}

--- affichage ---
OK   0.5 -> fraction                                "½"
OK   1.5 -> mixte                                   "1 ½"
OK   0.25                                           "¼"
OK   3                                              "3"
OK   ligne complete                                 "2 c. à soupe sauce soja"

--- alias d unites (ce que rend une IA) ---
OK   "cuilleres a soupe" compatible "c. à soupe"    true
OK   "tbsp" compatible "c. à soupe"                 true
OK   g compatible kg                                true
OK   g NON compatible ml                            false
OK   gousse NON compatible g                        false

22 OK, 0 echec(s)
 * ou Unknown command: "test"


Did you mean this?
  npm test # Test a package
To see a list of supported npm commands, run:
  npm help. Le jour où le projet gagne vitest, ces cas se reprennent tels quels.
 */

import { addQuantities, scaleQuantity, formatQuantity, areUnitsCompatible, formatIngredientLine } from '../units.js';

let pass = 0, fail = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label.padEnd(46)} ${JSON.stringify(got)}${ok ? '' : ' != ' + JSON.stringify(want)}`);
  ok ? pass++ : fail++;
};

console.log('--- fusion ---');
check('500g + 700g', addQuantities({quantity:500,unit:'g'},{quantity:700,unit:'g'}), {quantity:1.2,unit:'kg'});
check('2 + 1 (sans unite)', addQuantities({quantity:2,unit:null},{quantity:1,unit:null}), {quantity:3,unit:null});
check('200g + 4 pieces -> refus', addQuantities({quantity:200,unit:'g'},{quantity:4,unit:null}), null);
check('1 kg + 500 g', addQuantities({quantity:1,unit:'kg'},{quantity:500,unit:'g'}), {quantity:1.5,unit:'kg'});
check('25 cl + 25 cl', addQuantities({quantity:25,unit:'cl'},{quantity:25,unit:'cl'}), {quantity:50,unit:'cl'});
check('2 cas + 1 cas', addQuantities({quantity:2,unit:'c. à soupe'},{quantity:1,unit:'c. à soupe'}), {quantity:3,unit:'c. à soupe'});
check('null + 2 => null (jamais invente)', addQuantities({quantity:null,unit:null},{quantity:2,unit:null}), {quantity:null,unit:null});

console.log('\n--- portions dynamiques (§11) ---');
check('500g pour 4 -> 8 pers = 1kg', scaleQuantity(500,'g',4,8), {quantity:1,unit:'kg'});
check('4 filets pour 4 -> 8 pers', scaleQuantity(4,null,4,8), {quantity:8,unit:null});
check('150g pour 4 -> 6 pers', scaleQuantity(150,'g',4,6), {quantity:225,unit:'g'});
check('null reste null apres scaling', scaleQuantity(null,'g',4,8), {quantity:null,unit:'g'});
check('2 cas pour 4 -> 2 pers', scaleQuantity(2,'c. à soupe',4,2), {quantity:1,unit:'c. à soupe'});

console.log('\n--- affichage ---');
check('0.5 -> fraction', formatQuantity(0.5), '½');
check('1.5 -> mixte', formatQuantity(1.5), '1 ½');
check('0.25', formatQuantity(0.25), '¼');
check('3', formatQuantity(3), '3');
check('ligne complete', formatIngredientLine({quantity:2,unit:'c. à soupe',label:'sauce soja',preparation:null}), '2 c. à soupe sauce soja');

console.log('\n--- alias d unites (ce que rend une IA) ---');
check('"cuilleres a soupe" compatible "c. à soupe"', areUnitsCompatible('cuilleres a soupe','c. à soupe'), true);
check('"tbsp" compatible "c. à soupe"', areUnitsCompatible('tbsp','c. à soupe'), true);
check('g compatible kg', areUnitsCompatible('g','kg'), true);
check('g NON compatible ml', areUnitsCompatible('g','ml'), false);
check('gousse NON compatible g', areUnitsCompatible('gousse','g'), false);

console.log(`\n${pass} OK, ${fail} echec(s)`);
process.exit(fail > 0 ? 1 : 0);
