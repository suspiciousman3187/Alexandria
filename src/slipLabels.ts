// Porter Moogle slip number -> the armor set(s) it stores, so slips read by contents, not "Storage Slip NN".
export const SLIP_CONTENTS: Record<number, string> = {
  1: 'Salvage / Nyzul / Einherjar / Assault', 2: "Abjuration / Tu'Lia / Lumoria / Limbus / Unity",
  3: 'Zeni / Campaign / Voidwatch / Twilight / Voracious', 4: 'Artifact', 5: 'Artifact +1',
  6: 'Relic', 7: 'Relic +1', 8: 'Empyrean', 9: 'Empyrean +1', 10: 'Empyrean +2',
  11: 'Scenario Rewards', 12: 'Relic -1', 13: 'Relic +2 (aug)', 14: 'Lv.99 Nyzul / Einherjar / Salvage / Domain',
  15: 'Reforged Artifact', 16: 'Reforged Artifact +1', 17: 'Reforged Relic', 18: 'Reforged Relic +1',
  19: 'Scenario Rewards II', 20: 'Reforged Empyrean', 21: 'Reforged Empyrean +1', 22: 'Scenario Rewards III',
  23: 'Ambuscade', 24: 'Reforged Artifact +2', 25: 'Reforged Artifact +3', 26: 'Reforged Relic +2',
  27: 'Reforged Relic +3', 28: 'Ambuscade Weapons', 29: 'Reforged Empyrean +2', 30: 'Reforged Empyrean +3',
  31: 'Scenario Rewards IV', 32: 'Reforged Artifact +4', 33: 'Reforged Relic +4',
};
export const slipLabel = (s: { num: number; name: string }) => SLIP_CONTENTS[s.num] ?? s.name;
