import * as fs from 'node:fs';
import * as zlib from 'node:zlib';
import { anonymize, findPlayerLeaks } from '../src/anonymize';

const path = process.argv[2];
if (!path) { console.error('Usage: ts-node test-leak.ts <path-to-encounter.json.gz>'); process.exit(1); }
const buf = zlib.gunzipSync(fs.readFileSync(path));
const payload = JSON.parse(buf.toString('utf8'));
const inner = payload.content.record ?? payload.content.encounter ?? payload.content;

console.log('Before anonymize() - SC- entries in aminon.damageReport:');
for (const e of (inner.aminon?.damageReport ?? []).filter((x: { isSkillchain?: boolean }) => x.isSkillchain)) {
  console.log(' ', JSON.stringify({ name: e.name, owner: e.skillchainOwner }));
}

console.log('\nfindPlayerLeaks on ORIGINAL (sanity - should NOT be clean):');
const preLeaks = findPlayerLeaks(inner);
console.log(' count:', preLeaks.length, '|', preLeaks.slice(0, 8));

const cleaned = anonymize(inner);
console.log('\nAfter anonymize() - SC- entries:');
for (const e of (cleaned.aminon?.damageReport ?? []).filter((x: { isSkillchain?: boolean }) => x.isSkillchain)) {
  console.log(' ', JSON.stringify({ name: e.name, owner: e.skillchainOwner }));
}

const postLeaks = findPlayerLeaks(cleaned);
console.log('\nLeaks AFTER anonymize:', postLeaks.length === 0 ? 'NONE ✓' : `LEAKED: ${postLeaks.join(', ')}`);
