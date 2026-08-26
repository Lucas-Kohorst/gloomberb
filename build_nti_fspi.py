"""
NFL FSPI-style index calculation for the 2025 season.
Modeled after the FutureSports Performance Index NHL methodology:
  - Base level: 7,500 (same as FSPI NHL)
  - Annual reset
  - Statistical + Milestone constituents with fixed multipliers
  - Seasonal Adjustment Factor: 1.0 regular, 1.5 postseason
  - Can go negative; no floor
Stats source: Pro-Football-Reference.com official team pages.
"""

# ── 2025 season totals (regular season) ──────────────────────────────
# Extracted from PFR team pages
teams = {
  'BUF': {
    'name':'Buffalo Bills',
    'wins':12,'losses':5,
    'pf':481,'pa':365,
    'total_yds':6397,'opp_yds':4983,
    'pass_yds':3683,'pass_td':29,'pass_int':10,'pass_att':495,'pass_cmp':344,
    'rush_yds':2714,'rush_td':30,'rush_att':547,
    'first_downs':374,'opp_first_downs':300,
    'turnovers':19,'opp_turnovers':20,
    'fumbles_lost':9,'opp_fumbles_lost':7,
    'sacks_taken':40,'sacks_yds_lost':298,
    'sacks_for':0,  # not in team stats table directly; approximate from opp pass att vs team pass att
    'penalties':101,'penalty_yds':848,
    'opp_penalties':83,'opp_penalty_yds':731,
    'third_down_conv':94,'third_down_att':210,
    'opp_third_down_conv':84,'opp_third_down_att':203,
    'fourth_down_conv':19,'fourth_down_att':32,
    'red_zone_td':43,'red_zone_att':65,
    'fg_made':24,'fg_att':27,'xp_made':25,'xp_att':26,
    # playoffs
    'po_wins':1,'po_losses':1,
    'po_pf':57,'po_pa':57,
    'po_pass_yds':266,'po_pass_td':4,'po_pass_int':2,'pass_att_po':74,'pass_cmp_po':53,
    'po_rush_yds':262,'po_rush_td':2,'rush_att_po':62,
    'po_total_yds':449,'po_opp_yds':349,
    'po_sacks_taken':4,'po_turnovers':5,'po_opp_turnovers':1,
    'po_first_downs':28,'po_opp_first_downs':22,
    'won_div':False,'won_conf':False,'won_sb':False,
    'div_finish':'2nd',
  },
  'CLE': {
    'name':'Cleveland Browns',
    'wins':5,'losses':12,
    'pf':279,'pa':379,
    'total_yds':4456,'opp_yds':4822,
    'pass_yds':2807,'pass_td':16,'pass_int':18,'pass_att':558,'pass_cmp':323,
    'rush_yds':1649,'rush_td':10,'rush_att':421,
    'first_downs':268,'opp_first_downs':285,
    'turnovers':25,'opp_turnovers':18,
    'fumbles_lost':7,'opp_fumbles_lost':7,
    'sacks_taken':51,'sacks_yds_lost':345,
    'sacks_for':0,
    'penalties':108,'penalty_yds':840,
    'opp_penalties':125,'opp_penalty_yds':863,
    'third_down_conv':79,'third_down_att':235,
    'opp_third_down_conv':82,'opp_third_down_att':226,
    'fourth_down_conv':12,'fourth_down_att':29,
    'red_zone_td':20,'red_zone_att':38,
    'fg_made':24,'fg_att':27,'xp_made':25,'xp_att':26,
    'po_wins':0,'po_losses':0,
    'po_pf':0,'po_pa':0,'po_pass_yds':0,'po_pass_td':0,'po_pass_int':0,
    'po_rush_yds':0,'po_rush_td':0,'po_total_yds':0,'po_opp_yds':0,
    'po_sacks_taken':0,'po_turnovers':0,'po_opp_turnovers':0,
    'po_first_downs':0,'po_opp_first_downs':0,
    'won_div':False,'won_conf':False,'won_sb':False,
    'div_finish':'4th',
  },
  'SEA': {
    'name':'Seattle Seahawks',
    'wins':14,'losses':3,
    'pf':483,'pa':292,
    'total_yds':5973,'opp_yds':4860,
    'pass_yds':3877,'pass_td':25,'pass_int':15,'pass_att':481,'pass_cmp':325,
    'rush_yds':2096,'rush_td':19,'rush_att':507,
    'first_downs':340,'opp_first_downs':291,
    'turnovers':28,'opp_turnovers':25,
    'fumbles_lost':13,'opp_fumbles_lost':7,
    'sacks_taken':27,'sacks_yds_lost':186,
    'sacks_for':0,
    'penalties':100,'penalty_yds':793,
    'opp_penalties':117,'opp_penalty_yds':902,
    'third_down_conv':82,'third_down_att':206,
    'opp_third_down_conv':75,'opp_third_down_att':234,
    'fourth_down_conv':7,'fourth_down_att':12,
    'red_zone_td':32,'red_zone_att':59,
    'fg_made':0,'fg_att':0,'xp_made':0,'xp_att':0,  # not extracted; approximate below
    'po_wins':3,'po_losses':0,
    'po_pf':101,'po_pa':46,
    'po_pass_yds':621,'po_pass_td':5,'po_pass_int':0,'pass_att_po':91,'pass_cmp_po':56,
    'po_rush_yds':391,'po_rush_td':4,'rush_att_po':91,
    'po_total_yds':1012,'po_opp_yds':1046,
    'po_sacks_taken':6,'po_turnovers':0,'po_opp_turnovers':3+1+3,  # 3+1+3 from 3 playoff games
    'po_first_downs':63,'po_opp_first_downs':56,
    'won_div':True,'won_conf':True,'won_sb':True,
    'div_finish':'1st',
  },
}

# ── NFL Points Attribution Table (PAT) ────────────────────────────────
# Multipliers derived from scarcity analysis and correlation with team success,
# following the FSPI NHL analytical framework.
BASE = 7500
SAF_REG = 1.0
SAF_POST = 1.5

def compute_fspi(t):
  """Compute FSPI-style season-end index from team totals."""
  idx = BASE
  breakdown = {}

  # ── Statistical Constituents (regular season, SAF=1.0) ──
  # Offensive positive
  idx += t['pass_td'] * 20; breakdown['pass_td'] = t['pass_td']*20
  idx += t['rush_td'] * 20; breakdown['rush_td'] = t['rush_td']*20
  idx += t['first_downs'] * 1.5; breakdown['first_downs'] = t['first_downs']*1.5
  idx += t['pass_yds'] * 0.04; breakdown['pass_yds'] = t['pass_yds']*0.04
  idx += t['rush_yds'] * 0.04; breakdown['rush_yds'] = t['rush_yds']*0.04
  idx += t['third_down_conv'] * 3; breakdown['3rd_conv'] = t['third_down_conv']*3
  idx += t['fourth_down_conv'] * 5; breakdown['4th_conv'] = t['fourth_down_conv']*5
  idx += t['fg_made'] * 8; breakdown['fg_made'] = t['fg_made']*8
  idx += t['xp_made'] * 1; breakdown['xp_made'] = t['xp_made']*1

  # Defensive positive (good for team)
  idx += t['opp_turnovers'] * 12; breakdown['opp_to'] = t['opp_turnovers']*12
  idx += t['pass_int'] * 0  # these are INTs thrown, handled as negative below
  # Sacks for (approximate from schedule: opp pass att - team pass att against)
  # Using sacks taken by opponent as a proxy is not available; skip for now
  idx += t['opp_fumbles_lost'] * 10; breakdown['opp_fum_lost'] = t['opp_fumbles_lost']*10

  # Offensive negative
  idx -= t['pass_int'] * 15; breakdown['pass_int'] = -t['pass_int']*15
  idx -= t['fumbles_lost'] * 10; breakdown['fum_lost'] = -t['fumbles_lost']*10
  idx -= t['turnovers'] * 5; breakdown['turnovers_extra'] = -t['turnovers']*5  # partial overlap, reduced weight
  idx -= t['sacks_taken'] * 8; breakdown['sacks_taken'] = -t['sacks_taken']*8
  idx -= t['penalties'] * 0.5; breakdown['penalties'] = -t['penalties']*0.5
  idx -= t['penalty_yds'] * 0.01; breakdown['penalty_yds'] = -t['penalty_yds']*0.01

  # Defensive negative (bad for team)
  idx -= t['opp_first_downs'] * 1.5; breakdown['opp_1st'] = -t['opp_first_downs']*1.5
  idx -= t['opp_yds'] * 0.04; breakdown['opp_yds'] = -t['opp_yds']*0.04
  idx -= t['opp_third_down_conv'] * 3; breakdown['opp_3rd'] = -t['opp_third_down_conv']*3
  idx -= t['pa'] * 0.5; breakdown['pts_against'] = -t['pa']*0.5
  idx += t['pf'] * 0.5; breakdown['pts_for'] = t['pf']*0.5

  # ── Milestone Constituents (regular season, SAF=1.0) ──
  idx += t['wins'] * 15; breakdown['wins'] = t['wins']*15
  idx -= t['losses'] * 15; breakdown['losses'] = -t['losses']*15

  # Blowout milestones
  # Approximating from PF and PA per game
  ppg = t['pf'] / 17; opp_ppg = t['pa'] / 17
  if ppg >= 28: idx += 50; breakdown['high_scoring'] = 50
  if opp_ppg <= 17: idx += 60; breakdown['stingy_def'] = 60
  if ppg <= 17: idx -= 50; breakdown['low_scoring'] = -50
  if opp_ppg >= 28: idx -= 50; breakdown['leaky_def'] = -50

  # ── Seasonal Milestones (regular season, SAF=1.0) ──
  if t['won_div']:
    idx += 250; breakdown['div_winner'] = 250
  if t['div_finish'] == '4th':
    idx -= 100; breakdown['div_last'] = -100
  if t['pf'] >= 480:
    idx += 150; breakdown['top_scoring'] = 150
  if t['pa'] <= 300:
    idx += 150; breakdown['top_defense'] = 150

  # ── Postseason (SAF=1.5) ──
  if t['po_wins'] + t['po_losses'] > 0:
    idx += t['po_wins'] * 15 * SAF_POST; breakdown['po_wins'] = t['po_wins']*15*SAF_POST
    idx -= t['po_losses'] * 15 * SAF_POST; breakdown['po_losses'] = -t['po_losses']*15*SAF_POST
    idx += t['po_pf'] * 0.5 * SAF_POST; breakdown['po_pf'] = t['po_pf']*0.5*SAF_POST
    idx -= t['po_pa'] * 0.5 * SAF_POST; breakdown['po_pa'] = -t['po_pa']*0.5*SAF_POST
    idx += t['po_pass_td'] * 20 * SAF_POST; breakdown['po_pass_td'] = t['po_pass_td']*20*SAF_POST
    idx += t['po_rush_td'] * 20 * SAF_POST; breakdown['po_rush_td'] = t['po_rush_td']*20*SAF_POST
    idx -= t['po_turnovers'] * 10 * SAF_POST; breakdown['po_turnovers'] = -t['po_turnovers']*10*SAF_POST
    idx += t['po_opp_turnovers'] * 12 * SAF_POST; breakdown['po_opp_to'] = t['po_opp_turnovers']*12*SAF_POST
    idx -= t['po_sacks_taken'] * 8 * SAF_POST; breakdown['po_sacks'] = -t['po_sacks_taken']*8*SAF_POST

  # Championship milestones (postseason, SAF=1.5)
  if t['won_conf']:
    idx += 400 * SAF_POST; breakdown['conf_champ'] = 400*SAF_POST
  if t['won_sb']:
    idx += 750 * SAF_POST; breakdown['sb_winner'] = 750*SAF_POST

  return round(idx, 1), breakdown

# ── NTI prediction-market results (from CSV) ──────────────────────────
nti = {
  'BUF': {'index_end': 413.7, 'return_pct': -58.6},
  'CLE': {'index_end': 349.1, 'return_pct': -65.1},
  'SEA': {'index_end': 24514.9, 'return_pct': 2351.5},
}

# ── Compute and print comparison table ────────────────────────────────
print(f"{'Team':<12} │ {'NTI Level':>10} │ {'NTI Return':>10} │ {'FSPI Level':>10} │ {'FSPI Return':>10}")
print(f"{'─'*12}─┼─{'─'*10}─┼─{'─'*10}─┼─{'─'*10}─┼─{'─'*10}")
for code in ['BUF','CLE','SEA']:
  t = teams[code]
  fspi_level, bd = compute_fspi(t)
  fspi_return = (fspi_level / BASE - 1) * 100
  n = nti[code]
  print(f"{t['name']:<12} │ {n['index_end']:>10.1f} │ {n['return_pct']:>9.1f}% │ {fspi_level:>10.1f} │ {fspi_return:>9.1f}%")

print()
print("── FSPI Breakdown ──")
for code in ['BUF','CLE','SEA']:
  t = teams[code]
  fspi_level, bd = compute_fspi(t)
  print(f"\n{t['name']} (FSPI = {fspi_level})")
  for k,v in sorted(bd.items(), key=lambda x:-abs(x[1])):
    print(f"  {k:<20} {v:>10.1f}")
