// Job palette shared with Sage (BoT JobIcon) so job codes read the same across the tools, plus full names.
const JOB_COLORS: Record<string, string> = {
  WAR: '#e05545', MNK: '#e0913f', WHM: '#d8d0c0', BLM: '#9a6fd6', RDM: '#e0607e', THF: '#67b04f',
  PLD: '#6fb2e6', DRK: '#a24e78', BST: '#b98f57', BRD: '#d96ac8', RNG: '#3f9e6f', SAM: '#d95f38',
  NIN: '#8790cc', DRG: '#5772d6', SMN: '#4fb59a', BLU: '#4f9be0', COR: '#e0b64a', PUP: '#b3763c',
  DNC: '#ef9ab6', SCH: '#74c0a0', GEO: '#aac24f', RUN: '#57c4cc',
};
const JOB_NAMES: Record<string, string> = {
  WAR: 'Warrior', MNK: 'Monk', WHM: 'White Mage', BLM: 'Black Mage', RDM: 'Red Mage', THF: 'Thief',
  PLD: 'Paladin', DRK: 'Dark Knight', BST: 'Beastmaster', BRD: 'Bard', RNG: 'Ranger', SAM: 'Samurai',
  NIN: 'Ninja', DRG: 'Dragoon', SMN: 'Summoner', BLU: 'Blue Mage', COR: 'Corsair', PUP: 'Puppetmaster',
  DNC: 'Dancer', SCH: 'Scholar', GEO: 'Geomancer', RUN: 'Rune Fencer',
};

export const jobColor = (code?: string) => (code && JOB_COLORS[code]) || 'var(--color-fg-2)';
export const jobFullName = (code?: string) => (code && JOB_NAMES[code]) || code || '';
