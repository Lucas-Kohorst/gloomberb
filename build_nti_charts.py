import csv, json, math, urllib.request
from pathlib import Path
from statistics import NormalDist
import matplotlib.pyplot as plt
import numpy as np

ROOT=Path('/Users/lucas/Desktop/Work/project/gloom')
OUT=ROOT/'nti-research'; OUT.mkdir(exist_ok=True)
COVERS=json.loads((ROOT/'nti-research-covers.json').read_text())
WINS=json.loads(Path('/tmp/nti_2025_wins_candles.json').read_text())
YEARS=range(2020,2026)
TEAMS=['ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','IND','JAC','KC','LV','LAC','LAR','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SF','SEA','TB','TEN','WAS']
DIV={'ARI':'NFC West','LAR':'NFC West','SF':'NFC West','SEA':'NFC West','DAL':'NFC East','NYG':'NFC East','PHI':'NFC East','WAS':'NFC East','CHI':'NFC North','DET':'NFC North','GB':'NFC North','MIN':'NFC North','ATL':'NFC South','CAR':'NFC South','NO':'NFC South','TB':'NFC South','BUF':'AFC East','MIA':'AFC East','NE':'AFC East','NYJ':'AFC East','BAL':'AFC North','CIN':'AFC North','CLE':'AFC North','PIT':'AFC North','HOU':'AFC South','IND':'AFC South','JAC':'AFC South','TEN':'AFC South','DEN':'AFC West','KC':'AFC West','LAC':'AFC West','LV':'AFC West'}
CONF={'AFC':'AFC','NFC':'NFC'}
SB={2020:'TB',2021:'LAR',2022:'KC',2023:'KC',2024:'PHI',2025:'SEA'}
CONF_WIN={2020:{'AFC':'KC','NFC':'TB'},2021:{'AFC':'CIN','NFC':'LAR'},2022:{'AFC':'KC','NFC':'PHI'},2023:{'AFC':'KC','NFC':'SF'},2024:{'AFC':'KC','NFC':'PHI'},2025:{'AFC':'NE','NFC':'SEA'}}

def row_for(team, table, year):
 z=next(x for x in COVERS if x['team']==team)
 for r in z['tables'][table]:
  if r and r[0]==str(year): return r
 return None

def american(s):
 if not s or s in ('-','--'): return None
 try:
  x=float(s.replace(',',''))
  return 100/(x+100) if x>=0 else -x/(-x+100)
 except: return None

def winner_div(team,year):
 r=row_for(team,2,year)
 return bool(r and any('WINNER' in x for x in r))

def team_div_winners(year): return {t for t in TEAMS if winner_div(t,year)}

def normal_tail(x,mean,sd=2.2): return 1-NormalDist(mu=mean,sigma=sd).cdf(x-0.5)

# Actual Kalshi September marks, keyed by team and strike number (Tn means > n.5 / >=n+1).
winrows={r['ticker']:r for r in WINS if 'error' not in r}
def candle_mid(r):
 cs=r.get('candles',[])
 if not cs:return None
 c=cs[0]; b=c.get('yes_bid',{}).get('close'); a=c.get('yes_ask',{}).get('close')
 try:
  if b is not None and a is not None:return (float(b)+float(a))/2
  return float(c.get('price',{}).get('close'))
 except:return None

def actual_2025_win_sleeve(team):
 probs={}
 for n in range(1,18):
  r=winrows.get(f'KXNFLWINS-{team}-25B-T{n}')
  p=candle_mid(r) if r else None
  if p is not None: probs[n+1]=p
 if len(probs)<10:return None
 expected=1+sum(probs.values())
 available=sorted(probs)
 lo_candidates=[k for k in available if k<=expected]
 hi_candidates=[k for k in available if k>=expected]
 lo=max(available[0], lo_candidates[-1] if lo_candidates else available[0])
 hi=min(available[-1], hi_candidates[0] if hi_candidates else available[-1])
 if hi==lo:
  hi=next((k for k in available if k>lo),lo)
  lo=next((k for k in reversed(available) if k<hi),lo)
 span=max(1,hi-lo)
 w_hi=max(0,min(1,(expected-lo)/span)); w_lo=1-w_hi
 def price(k):
  r=winrows.get(f'KXNFLWINS-{team}-25B-T{k-1}')
  return candle_mid(r) if r else None
 p_lo,p_hi=price(lo),price(hi)
 if p_lo is None or p_hi is None:return None
 v_lo=1 if lo<=12 else 0 # overwritten from actual results below
 # result means threshold contract yes/no
 rlo=winrows[f'KXNFLWINS-{team}-25B-T{lo-1}']; rhi=winrows[f'KXNFLWINS-{team}-25B-T{hi-1}']
 qlo=1 if rlo.get('result')=='yes' else 0; qhi=1 if rhi.get('result')=='yes' else 0
 return {'forecast':expected,'lo':lo,'hi':hi,'w_lo':w_lo,'w_hi':w_hi,'p_lo':p_lo,'p_hi':p_hi,'q_lo':qlo,'q_hi':qhi,'source':'Kalshi archived Sep 1 midpoint'}

def synthetic_win_sleeve(team,year):
 r=row_for(team,3,year); mean=float(r[1]) if r and r[1] else 8.5
 lo=max(1,min(17,math.floor(mean))); hi=min(18,lo+1)
 if hi==lo:lo=max(1,lo-1)
 w_hi=max(0,min(1,mean-lo)); w_lo=1-w_hi
 p_lo=normal_tail(lo,mean); p_hi=normal_tail(hi,mean)
 # Parse actual regular-season wins from Covers row.
 actual=float(r[5]) if r and len(r)>5 and r[5] else mean
 q_lo=1 if actual>=lo else 0; q_hi=1 if actual>=hi else 0
 return {'forecast':mean,'lo':lo,'hi':hi,'w_lo':w_lo,'w_hi':w_hi,'p_lo':p_lo,'p_hi':p_hi,'q_lo':q_lo,'q_hi':q_hi,'source':'Covers preseason line + normal model'}

def sleeve_ratio(p,q): return q/p if p and p>0 else 0
records=[]
for year in YEARS:
 for team in TEAMS:
  sbp=american((row_for(team,0,year) or ['', '',])[1] if row_for(team,0,year) else None)
  conf='AFC' if team in ['BUF','MIA','NE','NYJ','BAL','CIN','CLE','PIT','HOU','IND','JAC','TEN','DEN','KC','LAC','LV'] else 'NFC'
  cp=american((row_for(team,1,year) or ['', '',])[1] if row_for(team,1,year) else None)
  dp=american((row_for(team,2,year) or ['', '',])[1] if row_for(team,2,year) else None)
  ws=actual_2025_win_sleeve(team) if year==2025 else synthetic_win_sleeve(team,year)
  if ws is None:
   ws=synthetic_win_sleeve(team,year)
   ws['source']='Covers preseason line + normal model (Kalshi ladder gap)'
  # 2025 Kalshi conference/division marks are pending endpoint collection; Covers is used consistently here.
  qsb=1 if SB[year]==team else 0
  qconf=1 if CONF_WIN[year][conf]==team else 0
  qdiv=1 if team in team_div_winners(year) else 0
  sb_ratio=sleeve_ratio(sbp,qsb); conf_ratio=sleeve_ratio(cp,qconf); div_ratio=sleeve_ratio(dp,qdiv)
  win_ratio=w_hi_ratio=(ws['w_lo']*sleeve_ratio(ws['p_lo'],ws['q_lo']) + ws['w_hi']*sleeve_ratio(ws['p_hi'],ws['q_hi']))
  index=1000*0.25*(sb_ratio+conf_ratio+div_ratio+win_ratio)
  records.append({'season':year,'team':team,'index_start':1000,'index_end':index,'return_pct':index/10-100,'sb_open':sbp,'conf_open':cp,'div_open':dp,'wins_forecast':ws['forecast'],'wins_lo':ws['lo'],'wins_hi':ws['hi'],'wins_lo_weight':ws['w_lo'],'wins_hi_weight':ws['w_hi'],'wins_lo_open':ws['p_lo'],'wins_hi_open':ws['p_hi'],'wins_source':ws['source'],'sb_source':'Covers preseason futures','conf_source':'Covers preseason futures','div_source':'Covers preseason futures'})

with (OUT/'nti_season_endpoints.csv').open('w',newline='') as f:
 w=csv.DictWriter(f,fieldnames=records[0].keys());w.writeheader();w.writerows(records)
# Heatmap and log-scale endpoint chart.
for kind in ['index_end','return_pct']:
 fig,ax=plt.subplots(figsize=(16,11))
 vals=np.array([[next(r[kind] for r in records if r['team']==t and r['season']==y) for y in YEARS] for t in TEAMS],float)
 if kind=='index_end':
  plot=np.log10(np.clip(vals,1,1e6)); im=ax.imshow(plot,cmap='RdYlGn',aspect='auto',vmin=0,vmax=5)
  ax.set_title('NTI revised methodology: season-end index level (log10 scale)')
  cb=fig.colorbar(im,ax=ax);cb.set_label('log10(index level)')
 else:
  plot=np.clip(vals,-100,100); im=ax.imshow(plot,cmap='RdYlGn',aspect='auto',vmin=-100,vmax=100)
  ax.set_title('NTI revised methodology: season return (%)')
  cb=fig.colorbar(im,ax=ax);cb.set_label('return (%)')
 ax.set_xticks(range(6),list(YEARS));ax.set_yticks(range(len(TEAMS)),TEAMS)
 for i in range(len(TEAMS)):
  for j in range(6):
   text=f'{vals[i,j]:.0f}' if kind=='index_end' else f'{vals[i,j]:.0f}%'
   ax.text(j,i,text,ha='center',va='center',fontsize=6,color='black')
 fig.tight_layout();fig.savefig(OUT/f'nti_{kind}.png',dpi=180);plt.close(fig)
print('wrote',OUT/'nti_season_endpoints.csv')
print('wrote',OUT/'nti_index_end.png',OUT/'nti_return_pct.png')
print('sample',[(r['team'],r['season'],round(r['index_end'],1)) for r in records if r['season']==2025 and r['team'] in ['BUF','CLE','SEA']])
