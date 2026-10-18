// Groups the alignment review's measurements (Phase 15, part 1) by what is out of line and where, across screens and devices, so one cause reads as one
// row. Reads ux-review/<date>/alignment.json (written by `npm run ux:shoot -- --matrix brief --measure`) and writes alignment-summary.json and
// alignment-summary.md beside it; prints the table.
//
//   node scripts/local-site/align-report.js [--date YYYY-MM-DD] [--compare <other alignment.json>]
//
// With --compare it says, per group, how many pictures had it before and after (the measured before/after of RELEASE-15.md).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const args = process.argv.slice(2);
const option = (name) => { const at = args.indexOf(`--${name}`); return at === -1 ? null : args[at + 1]; };
const date = option('date') ?? new Date().toISOString().slice(0, 10);
const dir = path.join(ROOT, 'ux-review', date);
const source = path.join(dir, 'alignment.json');
if (!existsSync(source)) { console.error(`No ${source}: run npm run ux:shoot -- --matrix brief --measure first.`); process.exit(1); }

/** The selector without the per-instance part (an id), so the same component on two screens is one group. */
const shape = (where) => where.replace(/#[\w-]+/g, '');

export function groupFindings(shots) {
  const groups = new Map();
  for (const entry of shots) {
    for (const finding of entry.findings) {
      const key = `${finding.kind} | ${shape(finding.where)}`;
      const group = groups.get(key) ?? { kind: finding.kind, where: shape(finding.where), worst: 0, pictures: new Set(), devices: new Set(), screens: new Set(), examples: [] };
      const value = typeof finding.measured === 'number' ? finding.measured : parseFloat(String(finding.measured)) || 0;
      group.worst = Math.max(group.worst, value);
      group.pictures.add(entry.file);
      group.devices.add(entry.device);
      group.screens.add(`${entry.flow}/${entry.id}`);
      if (group.examples.length < 3) group.examples.push({ file: entry.file, measured: finding.measured, detail: finding.detail, text: finding.text });
      groups.set(key, group);
    }
  }
  return [...groups.values()].map((group) => ({ ...group, pictures: group.pictures.size, devices: [...group.devices].sort(), screens: [...group.screens].sort() }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || b.pictures - a.pictures);
}

const { shots } = JSON.parse(readFileSync(source, 'utf8'));
const groups = groupFindings(shots);
const before = option('compare') ? new Map(groupFindings(JSON.parse(readFileSync(option('compare'), 'utf8')).shots).map((group) => [`${group.kind} | ${group.where}`, group])) : null;
writeFileSync(path.join(dir, 'alignment-summary.json'), JSON.stringify(groups, null, 2));
const lines = [`# Alignment measurements, ${date}`, '', `${shots.length} pictures, ${groups.length} groups.`, '', '| kind | where | pictures | worst | devices | example |', '|---|---|---:|---:|---|---|'];
for (const group of groups) {
  const was = before?.get(`${group.kind} | ${group.where}`);
  lines.push(`| ${group.kind} | \`${group.where}\` | ${was ? `${was.pictures} → ` : ''}${group.pictures} | ${group.worst} | ${group.devices.join(', ')} | ${group.examples[0].detail} "${group.examples[0].text}" (${group.examples[0].file}) |`);
}
if (before) for (const [key, group] of before) if (!groups.some((fresh) => `${fresh.kind} | ${fresh.where}` === key)) lines.push(`| ${group.kind} | \`${group.where}\` | ${group.pictures} → 0 | | | gone |`);
writeFileSync(path.join(dir, 'alignment-summary.md'), `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
