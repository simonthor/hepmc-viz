const PDG_NAMES: Record<number, string> = {
  1: "down quark",
  2: "up quark",
  3: "strange quark",
  4: "charm quark",
  5: "bottom quark",
  6: "top quark",
  11: "electron",
  12: "electron neutrino",
  13: "muon",
  14: "muon neutrino",
  15: "tau",
  16: "tau neutrino",
  21: "gluon",
  22: "photon",
  23: "Z0",
  24: "W+",
  25: "Higgs",
  111: "pi0",
  113: "rho0",
  130: "K0_L",
  211: "pi+",
  221: "eta",
  223: "omega",
  321: "K+",
  331: "eta'",
  2112: "neutron",
  2212: "proton"
};

export function particleName(pdgId: number): string {
  if (PDG_NAMES[pdgId]) {
    return PDG_NAMES[pdgId];
  }

  if (pdgId < 0 && PDG_NAMES[-pdgId]) {
    return `anti-${PDG_NAMES[-pdgId]}`;
  }

  return `PDG ${pdgId}`;
}
