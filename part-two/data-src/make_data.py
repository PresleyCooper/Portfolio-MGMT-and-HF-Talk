"""Build js/data.js from public sources.

Usage (from this folder):  pip install arch rdata  &&  python3 make_data.py
Downloads the GitHub-hosted datasets and the EDHEC indexes on first run (into ./cache),
reads hand-collected series from ./raw, and writes ../js/data.js.
"""
import csv, json, math, collections, os, urllib.request, datetime
HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(HERE, 'cache') + '/'
os.makedirs(D + 'raw', exist_ok=True)
GH = 'https://raw.githubusercontent.com/'
FILES = {
    'exchange-rates_main_data_daily.csv': 'datasets/exchange-rates/main/data/daily.csv',
    'oil-prices_main_data_wti-daily.csv': 'datasets/oil-prices/main/data/wti-daily.csv',
    'gold-prices_main_data_monthly.csv': 'datasets/gold-prices/main/data/monthly.csv',
    'bond-yields-us-10y_main_data_monthly.csv': 'datasets/bond-yields-us-10y/main/data/monthly.csv',
    's-and-p-500_main_data_data.csv': 'datasets/s-and-p-500/main/data/data.csv',
    'edhec.rda': 'braverock/PerformanceAnalytics/master/data/edhec.rda',
}
for name, path in FILES.items():
    if not os.path.exists(D + name):
        urllib.request.urlretrieve(GH + path, D + name)
for name in ('gbpdem1992.txt', 'spy_monthly.txt', 'deals.json'):
    with open(os.path.join(HERE, 'raw', name)) as src, open(D + 'raw/' + name, 'w') as dst:
        dst.write(src.read())
# EDHEC monthly returns: decode the xts object (dates live in the 'index' attribute)
if not os.path.exists(D + 'edhec.csv'):
    import rdata
    p = rdata.parser.parse_file(D + 'edhec.rda', extension='rda')
    x = p.object.value[0]; a = x.attributes
    idx = a.value[1].value[1].value[0].value
    names = [c.value.decode() for c in a.value[1].value[0].value[1].value]
    vals = x.value.reshape((len(idx), len(names)), order='F')
    with open(D + 'edhec.csv', 'w') as f:
        w = csv.writer(f); w.writerow(['date'] + names)
        for t, r in zip(idx, vals):
            w.writerow([datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime('%Y-%m')] + list(r))
out={}
# ---- EDHEC monthly (decimal) ----
rows=list(csv.DictReader(open(D+'edhec.csv')))
keys={'Merger Arbitrage':'ma','Event Driven':'ed','Distressed Securities':'ds','Convertible Arbitrage':'ca',
'Fixed Income Arbitrage':'fia','Relative Value':'rv','Global Macro':'gm','CTA Global':'cta',
'Equity Market Neutral':'emn','Long/Short Equity':'lse','Short Selling':'ss','Funds of Funds':'fof'}
dates=[r['date'] for r in rows]
hf={v:[round(float(r[k])*100,2) for r in rows] for k,v in keys.items()}
# ---- market: French Mkt (Mkt-RF+RF) to 2018-11, SPY TR after ----
import arch.data.frenchdata as fr
f=fr.load()
mk={}
for idx,r in f.iterrows():
    s=str(idx)[-6:]; ym=s[:4]+'-'+s[4:]
    mk[ym]=round(r['Mkt-RF']+r['RF'],2)
spy=dict(l.strip().split(',') for l in open(D+'raw/spy_monthly.txt'))
spy={k:float(v.replace('%','')) for k,v in spy.items()}
mkt=[]
for d in dates:
    mkt.append(mk[d] if d in mk else spy[d])
rfm={}
for idx,r in f.iterrows():
    t=str(idx)[-6:]; rfm[t[:4]+'-'+t[4:]]=r['RF']
# After Nov 2018: approximate 1-month T-bill yields (monthly %), from published Fed policy-rate levels
def rf_after(d):
    y=int(d[:4]); mo=int(d[5:])
    if y==2018 or y==2019 and mo<=7: return 0.19
    if y==2019: return 0.15
    if y==2020 and mo<=2: return 0.13
    if y==2020 and mo==3: return 0.05
    return 0.01
rf=[round(rfm[d],3) if d in rfm else rf_after(d) for d in dates]
out['hf']={'dates':dates,'mkt':mkt,'rf':rf,**hf}
# ---- monthly helpers ----
def monthly_last(series):  # list of (date, val) daily -> dict YYYY-MM -> last
    m=collections.OrderedDict()
    for d,v in series: m[d[:7]]=v
    return m
fx=collections.defaultdict(list)
for r in csv.reader(open(D+'exchange-rates_main_data_daily.csv')):
    if r[0]=='Date' or not r[2]: continue
    try: fx[r[1]].append((r[0],float(r[2])))
    except: pass
wti=[(r[0],float(r[1])) for r in list(csv.reader(open(D+'oil-prices_main_data_wti-daily.csv')))[1:] if r[1] and float(r[1])>0]
gold={r[0]:float(r[1]) for r in list(csv.reader(open(D+'gold-prices_main_data_monthly.csv')))[1:]}
y10={r[0][:7]:float(r[1]) for r in list(csv.reader(open(D+'bond-yields-us-10y_main_data_monthly.csv')))[1:]}
spx={r[0][:7]:float(r[1]) for r in list(csv.reader(open(D+'s-and-p-500_main_data_data.csv')))[1:]}
jpy=monthly_last(fx['Japan']); gbp=monthly_last(fx['United Kingdom']); chf=monthly_last(fx['Switzerland']); aud=monthly_last(fx['Australia']); eur=monthly_last(fx['Euro'])
wtim=monthly_last(wti)
# ---- Trend universe: monthly returns, %. FX expressed as USD value of the foreign currency ----
months=[]
y,m=1987,1
while (y,m)<=(2026,9):
    months.append(f'{y}-{m:02d}'); m+=1
    if m>12: y+=1; m=1
def ret_price(dct, invert=False):
    r=[]
    for i,mo in enumerate(months):
        if i==0: r.append(None); continue
        a,b=dct.get(months[i-1]),dct.get(mo)
        if a is None or b is None: r.append(None); continue
        if invert: a,b=1/a,1/b
        r.append(round((b/a-1)*100,3))
    return r
def ret_bond():
    r=[None]
    for i in range(1,len(months)):
        a,b=y10.get(months[i-1]),y10.get(months[i])
        if a is None or b is None: r.append(None); continue
        D_=7.5
        r.append(round(a/12 - D_*(b-a),3))
    return r
trend={'months':months,'assets':[
 {'id':'spx','name':'S&P 500','r':ret_price(spx)},
 {'id':'ust','name':'10-yr Treasury','r':ret_bond()},
 {'id':'gold','name':'Gold','r':ret_price(gold)},
 {'id':'oil','name':'WTI crude','r':ret_price(wtim)},
 {'id':'jpy','name':'Japanese yen','r':ret_price(jpy,True)},
 {'id':'gbp','name':'British pound','r':ret_price(gbp,True)},
 {'id':'chf','name':'Swiss franc','r':ret_price(chf,True)},
 {'id':'aud','name':'Australian dollar','r':ret_price(aud,True)},
]}
out['trend']=trend
# ---- 1992 GBP/DEM daily ----
out['erm']=[[l.split(',')[0],float(l.split(',')[1])] for l in open(D+'raw/gbpdem1992.txt') if l.strip()]
# ---- yen carry: daily USD/JPY 2021-2024 ----
out['usdjpy']=[[d,v] for d,v in fx['Japan'] if '2021-01-01'<=d<='2024-12-31']
# ---- 2022 macro expressions (Dec 2021 -> Dec 2022 month-end) ----
def chg(dct,a='2021-12',b='2022-12',inv=False):
    x,y_=dct[a],dct[b]
    if inv: x,y_=1/x,1/y_
    return round((y_/x-1)*100,1)
spy22=[spy[f'2022-{i:02d}'] for i in range(1,13)]
spxTR=1
for v in spy22: spxTR*=1+v/100
bond22=1
for i in range(1,13):
    a=y10['2021-12' if i==1 else f'2022-{i-1:02d}']; b=y10[f'2022-{i:02d}']
    bond22*=1+(a/12-7.5*(b-a))/100
out['m2022']={
 'spx':round((spxTR-1)*100,1),'ust10':round((bond22-1)*100,1),
 'usdjpy':chg(jpy),'eurusd':chg(eur,inv=True),'oil':chg(wtim),'gold':chg(gold),
 'y10a':y10['2021-12'],'y10b':y10['2022-12']}
# monthly paths 2022 for chart (index 100 at Dec 2021)
def path(dct,inv=False):
    base=dct['2021-12']; base=1/base if inv else base
    return [round(((1/dct[mo] if inv else dct[mo])/base)*100,2) for mo in ['2021-12']+[f'2022-{i:02d}' for i in range(1,13)]]
sp=[100]; 
for v in spy22: sp.append(round(sp[-1]*(1+v/100),2))
bp=[100]; prev='2021-12'
for i in range(1,13):
    mo=f'2022-{i:02d}'; a,b=y10[prev],y10[mo]; bp.append(round(bp[-1]*(1+(a/12-7.5*(b-a))/100),2)); prev=mo
out['m2022paths']={'spx':sp,'ust10':bp,'usd_jpy':path(jpy),'eur':path(eur,True),'oil':path(wtim),'gold':path(gold)}
# ---- deals (monthly closes, digrin.com) ----
out['deals']=json.load(open(D+'raw/deals.json'))
# ---- 10y monthly yields 1997-2021 for bond proxy in allocator ----
b=[]
prev=None
for d in dates:
    yv=y10.get(d); pv=y10.get(prev) if prev else None
    b.append(round(pv/12-7.5*(yv-pv),2) if pv else round(yv/12,2)); prev=d
out['hf']['bond']=b
with open(os.path.join(HERE, '..', 'js', 'data.js'), 'w') as f:
    f.write('// Real market data used by the charts. Sources are listed in README.md.\nwindow.DATA = ' + json.dumps(out, separators=(',', ':')) + ';\n')
print('wrote js/data.js:', len(dates), 'months of hedge fund data')
