const PDG_NAMES: Record<number, string> = {
  1: "d",
  2: "u",
  3: "s",
  4: "c",
  5: "b",
  6: "t",
  11: "e^-",
  12: "\\nu_e",
  13: "\\mu^-",
  14: "\\nu_\\mu",
  15: "\\tau^-",
  16: "\\nu_\\tau",
  21: "g",
  22: "\\gamma",
  23: "Z^0",
  24: "W^+",
  25: "H",
  [-1]: "\\bar{d}",
  [-2]: "\\bar{u}",
  [-3]: "\\bar{s}",
  [-4]: "\\bar{c}",
  [-5]: "\\bar{b}",
  [-6]: "\\bar{t}",
  [-11]: "e^+",
  [-12]: "\\bar{\\nu}_e",
  [-13]: "\\mu^+",
  [-14]: "\\bar{\\nu}_\\mu",
  [-15]: "\\tau^+",
  [-16]: "\\bar{\\nu}_\\tau",
  [-24]: "W^-",
  [111]: "\\pi^0",
  [113]: "\\rho^0",
  [130]: "K^0_L",
  [211]: "\\pi^+",
  [-211]: "\\pi^-",
  [221]: "\\eta",
  [-221]: "\\eta",
  [223]: "\\omega",
  [-223]: "\\omega",
  [321]: "K^+",
  [-321]: "K^-",
  [331]: "\\eta'",
  [2112]: "n",
  [-2112]: "\\bar{n}",
  [2212]: "p",
  [-2212]: "\\bar{p}"
};

export function particleName(pdgId: number): string {
  if (PDG_NAMES[pdgId]) {
    return PDG_NAMES[pdgId];
  }

  if (pdgId < 0 && PDG_NAMES[-pdgId]) {
    return `\\bar{${PDG_NAMES[-pdgId]}}`;
  }

  return `\\text{PDG }${pdgId}`;
}
