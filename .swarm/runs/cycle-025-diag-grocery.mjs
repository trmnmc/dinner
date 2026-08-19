/** cycle-025 diag — dump the FULL shape of a live grocery line so the T-069
 *  gate can assert on real fields rather than guessed ones. */
import { boot, makeHousehold, makePlan, grocery } from './cycle-014-fixture.mjs';

const srv = await boot();
try {
  const householdId = await makeHousehold(srv.baseUrl);
  const plan = await makePlan(srv.baseUrl, householdId);
  const planId = plan?.plan?.plan_id;
  const g = await grocery(srv.baseUrl, householdId, planId);
  const lines = (g.body?.list?.sections ?? []).flatMap((s) => s.lines ?? []);
  console.log('status', g.status, 'lines', lines.length);
  console.log('--- one labelled line, in full ---');
  const labelled = lines.find((l) => l.package_label);
  console.log(JSON.stringify(labelled, null, 1));
  console.log('--- one estimate line, in full ---');
  const est = lines.find((l) => l.is_estimate === true);
  console.log(JSON.stringify(est, null, 1));
  console.log('--- census ---');
  for (const l of lines) {
    console.log(
      String(l.ingredient_id).padEnd(26),
      'label=' + JSON.stringify(l.package_label),
      'est=' + l.is_estimate,
    );
  }
} finally {
  await srv.stop();
}
