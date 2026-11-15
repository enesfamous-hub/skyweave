// Senaryoların zorluğu: bot her senaryoyu birkaç tohumla oynar.
import { runGame } from './bot.mjs';
import { SCENARIOS } from '../js/scenarios.js';
const seeds = +(process.argv[2] || 3);
for (const sc of SCENARIOS.filter(x => x.days)) {
  const res = [];
  for (let s = 1; s <= seeds; s++) {
    const { S } = runGame({ seed: 100 + s, days: sc.days, scenario: sc.id });
    const r = S.scenarioResult;
    res.push(r ? (r.won ? `✓gün${r.day}★${r.stars}` : '✗') : '?');
  }
  console.log(sc.id.padEnd(8), sc.days, res.join(' '));
}
