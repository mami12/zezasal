const WINDOWS_1252_BYTES: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86,
  '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c,
  'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95,
  '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b,
  'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

const MOJIBAKE = /[\u00c3\u00c2\u00e2\u00f0][\u0080-\u00ff\u2018-\u203a\u20ac\u0178]+/g;

function decodeMojibakeRun(run: string): string {
  const bytes = Uint8Array.from(Array.from(run, character => {
    const code = character.codePointAt(0)!;
    return WINDOWS_1252_BYTES[character] ?? (code <= 0xff ? code : 0x3f);
  }));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return run;
  }
}

export function repairDisplayText(value: unknown): string {
  let text = String(value ?? '');
  for (let pass = 0; pass < 2; pass += 1) {
    const repaired = text.replace(MOJIBAKE, decodeMojibakeRun);
    if (repaired === text) break;
    text = repaired;
  }
  return text;
}
