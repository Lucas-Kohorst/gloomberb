/** NFL team codes as Adjacent spells them in rate ids. */
const NTI_TEAM_BY_CODE: Record<string, string> = {
  ari: "Arizona Cardinals",
  atl: "Atlanta Falcons",
  bal: "Baltimore Ravens",
  buf: "Buffalo Bills",
  car: "Carolina Panthers",
  chi: "Chicago Bears",
  cin: "Cincinnati Bengals",
  cle: "Cleveland Browns",
  dal: "Dallas Cowboys",
  den: "Denver Broncos",
  det: "Detroit Lions",
  gb: "Green Bay Packers",
  hou: "Houston Texans",
  ind: "Indianapolis Colts",
  jac: "Jacksonville Jaguars",
  kc: "Kansas City Chiefs",
  lac: "Los Angeles Chargers",
  lar: "Los Angeles Rams",
  lv: "Las Vegas Raiders",
  mia: "Miami Dolphins",
  min: "Minnesota Vikings",
  ne: "New England Patriots",
  no: "New Orleans Saints",
  nyg: "New York Giants",
  nyj: "New York Jets",
  phi: "Philadelphia Eagles",
  pit: "Pittsburgh Steelers",
  sea: "Seattle Seahawks",
  sf: "San Francisco 49ers",
  tb: "Tampa Bay Buccaneers",
  ten: "Tennessee Titans",
  was: "Washington Commanders",
};

const NTI_TEAM_RATE_ID = /^nti_(?:mv_)?([a-z]{2,3})_/;

export function ntiTeamForRateId(rateId: string | null | undefined): string | null {
  if (typeof rateId !== "string") return null;
  const match = NTI_TEAM_RATE_ID.exec(rateId.trim().toLowerCase());
  if (!match) return null;
  return NTI_TEAM_BY_CODE[match[1]!] ?? null;
}
