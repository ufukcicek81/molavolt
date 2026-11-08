# Temporary diagnostics: how far real OSRM roads move away from the destination.
import json, math, time, urllib.request
def get(coords, alts):
    u="https://router.project-osrm.org/route/v1/driving/"+";".join(f"{lo},{la}" for la,lo in coords)+f"?overview=full&geometries=geojson&alternatives={'3' if alts else 'false'}&steps=false"
    for _ in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(u,headers={"User-Agent":"molavolt-probe"}),timeout=40) as r: return json.load(r).get("routes",[])
        except Exception as e: time.sleep(2)
    return []
def hk(a,b):
    R=6371;la1,lo1,la2,lo2=map(math.radians,(a[0],a[1],b[0],b[1]))
    x=math.sin((la2-la1)/2)**2+math.cos(la1)*math.cos(la2)*math.sin((lo2-lo1)/2)**2;return 2*R*math.asin(math.sqrt(x))
def pts(r): return [(c[1],c[0]) for c in r["geometry"]["coordinates"]]
def resample(p,step):
    out=[p[0]];acc=0
    for i in range(1,len(p)):
        acc+=hk(p[i-1],p[i])
        if acc>=step: out.append(p[i]);acc=0
    out.append(p[-1]);return out
def backtrack(p,dest,step):
    best=1e9;worst=0;at=0;along=0;prev=None
    for q in resample(p,step):
        if prev: along+=hk(prev,q)
        prev=q;d=hk(q,dest)
        if d<best: best=d
        elif d-best>worst: worst=d-best;at=along
    return round(worst,1),round(at)
def window(p,dest,win):  # largest net move away from destination within any `win` km of driving
    s=resample(p,0.5);d=[hk(q,dest) for q in s];n=max(1,int(win/0.5));return round(max(d[i+n]-d[i] for i in range(len(d)-n)) if len(d)>n else 0,1)
trips={"Düzce→Şanlıurfa":((40.84,31.16),(37.16,38.79)),"Düzce→Kars":((40.84,31.16),(40.60,43.10)),"Düzce→İzmir":((40.84,31.16),(38.42,27.14)),"Ankara→Antalya":((39.93,32.85),(36.90,30.70))}
for name,(a,z) in trips.items():
    print("=====",name)
    rs=get([a,z],True);time.sleep(1.2)
    mid=((a[0]+z[0])/2,(a[1]+z[1])/2);kx=math.cos(math.radians(mid[0]));dx=(z[1]-a[1])*kx;dy=z[0]-a[0];L=math.hypot(dx,dy);nx,ny=-dy/L,dx/L
    for f in (0.18,-0.18,0.32,-0.32):
        deg=f*L;via=(mid[0]+ny*deg,mid[1]+nx*deg/kx);r=get([a,via,z],False);time.sleep(1.2)
        if r: r[0]["_via"]=f;rs.append(r[0])
    f0=rs[0]
    for i,r in enumerate(rs):
        p=pts(r)
        print(f"{'via '+str(r.get('_via')) if r.get('_via') else 'osrm#'+str(i)}: {r['distance']/1000:.0f} km x{r['distance']/f0['distance']:.2f} dur x{r['duration']/f0['duration']:.2f} | back@0.5km {backtrack(p,z,0.5)} @2km {backtrack(p,z,2)} @5km {backtrack(p,z,5)} | win5 {window(p,z,5)} win10 {window(p,z,10)}")
