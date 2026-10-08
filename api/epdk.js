export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method === "OPTIONS") return res.status(204).end();
  const https = await import("https");
  function epdkRequest(bodyValue, label) {
    return new Promise((resolve) => {
      const body = typeof bodyValue === "string" ? bodyValue : JSON.stringify(bodyValue);
      const headers = {Accept:"application/json,text/plain,*/*","Content-Type":"application/json","Content-Length":Buffer.byteLength(body),"User-Agent":"Mozilla/5.0 MolaVolt/1.2"};
      const options = {hostname:"apigateway.epdk.gov.tr",path:"/sarjIstasyonlari/",method:"GET",headers,timeout:45000};
      const request = https.request(options, (response) => {
        let data=""; response.setEncoding("utf8"); response.on("data",chunk=>{data+=chunk});
        response.on("end",()=>{let json=null;try{json=JSON.parse(data)}catch(e){}resolve({label,statusCode:response.statusCode||500,raw:data,json})});
      });
      request.on("timeout",()=>request.destroy(new Error("EPDK timeout")));
      request.on("error",error=>resolve({label,statusCode:502,raw:JSON.stringify({ok:false,error:"EPDK bağlantı hatası",detail:error.message}),json:null}));
      request.write(body);request.end();
    });
  }
  function parseMaybe(v){if(typeof v!=="string")return v;const t=v.trim();if(!t)return v;try{return JSON.parse(t)}catch(e){}const a=t.indexOf("["),b=t.lastIndexOf("]");if(a>=0&&b>a){try{return JSON.parse(t.slice(a,b+1))}catch(e){}}const c=t.indexOf("{"),d=t.lastIndexOf("}");if(c>=0&&d>c){try{return JSON.parse(t.slice(c,d+1))}catch(e){}}return v}
  function rowObject(row,cols){row=parseMaybe(row);if(!Array.isArray(row))return row&&typeof row==="object"?row:{};const o={};(cols||[]).forEach((c,i)=>o[c]=row[i]);return o}
  function findRows(value,depth=0){value=parseMaybe(value);if(depth>5||value==null)return[];if(Array.isArray(value))return value;if(typeof value!=="object")return[];const preferred=["rows","data","result","items","records","list","content"];for(const key of preferred){if(value[key]!==undefined){const found=findRows(value[key],depth+1);if(found.length)return found}}for(const key of Object.keys(value)){const child=value[key];if(Array.isArray(child)&&child.length)return child}return[]}
  function getRows(json){return findRows(json)}
  function getColumns(json){json=parseMaybe(json);if(!json||typeof json!=="object")return[];for(const key of ["columnNames","columns","columnName","headers"]){const v=parseMaybe(json[key]);if(Array.isArray(v))return v.map(x=>typeof x==="object"?(x.name||x.key||x.columnName||String(x)):String(x))}if(json.result&&typeof json.result==="object")return getColumns(json.result);if(json.data&&typeof json.data==="object")return getColumns(json.data);return[]}
  function num(v){if(typeof v==="number"&&Number.isFinite(v))return v;const m=String(v??"").replace(",",".").match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):NaN}
  function firstValue(o,keys){for(const key of keys){if(o&&o[key]!==undefined&&o[key]!==null&&String(o[key]).trim()!=="")return o[key]}return""}
  const PRICE_KEYS=["soketFiyati","soketFiyat","soketBirimFiyati","soketBirimFiyat","birimFiyat","birimFiyatTl","birimFiyatTL","birimEnerjiFiyati","sarjHizmetiFiyati","sarjHizmetiFiyat","sarjHizmetiBirimFiyati","sarjHizmetiBirimFiyat","hizmetFiyati","hizmetFiyat","fiyat","fiyatTl","fiyatTL","price","unitPrice","tarife","ucret","ücret","kwhFiyat","kWhFiyat","enerjiBirimFiyati","enerjiBirimFiyat","acFiyat","dcFiyat","acPrice","dcPrice","ac_price","dc_price"];
  function priceValue(o,depth=0){if(!o||typeof o!=="object"||depth>6)return NaN;for(const k of PRICE_KEYS){if(Object.prototype.hasOwnProperty.call(o,k)){const n=num(o[k]);if(Number.isFinite(n)&&n>0&&n<100)return n;const p=parseMaybe(o[k]);if(p&&typeof p==="object"){const n2=priceValue(p,depth+1);if(Number.isFinite(n2))return n2;}}}for(const k of Object.keys(o)){const v=o[k];if(v&&typeof v==="object"){const n=priceValue(v,depth+1);if(Number.isFinite(n)&&n>0&&n<100)return n;}else if(typeof v==="string"&&/(tl|₺|kwh|fiyat|price|tarife|ücret|ucret)/i.test(k)){const n=num(v);if(Number.isFinite(n)&&n>0&&n<100)return n;}}return NaN}
  function power(o){return firstValue(o,["soketGucu","soketGücü","guc","güç","kw","power","gucKw","maxGuc","maxGüç"])}
  function socketType(o){return firstValue(o,["soketTipi","soketTuru","socketType","connectorType","tip","konnektorTipi"])}

  // MV_AVAILABILITY_TRUST_1008: explicit socket availability ONLY.
  // Public station "Aktif" status means operational; it never means an idle socket.
  function normKey(v){return String(v??"").toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/ı/g,"i");}
  function availabilityField(k,inSocket){
    const key=normKey(k);
    return /musait|available|availability|free|bos|uygun|occupied|mesgul|rezerv|doluluk|soket.*durum|socket.*status|connector.*status|port.*status/.test(key) ||
      (inSocket&&/^(durum|status|state)$/.test(key));
  }
  function socketArrayKey(k){return /soket|socket|connector|port|sarj.?unite|charge.?point/.test(normKey(k));}
  function statusValue(v,k,inSocket){
    const key=normKey(k);
    if(!availabilityField(k,inSocket))return "";
    const inverted=/occupied|mesgul|dolu|in.?use/.test(key);
    if(typeof v==="boolean")return v?(inverted?"busy":"ok"):(inverted?"ok":"busy");
    const s=normKey(v).trim();
    if(!s)return "";
    if(/ariza|bakim|offline|out.?of.?service|fault|hata|devre.?disi/.test(s))return "off";
    if(/^(dolu|occupied|busy|mesgul|in.?use|rezerve|reserved|charging|sarj.?ediyor)$/.test(s))return "busy";
    if(/^(musait|uygun|bos|bosta|kullanilabilir|available|free|ready|idle|unoccupied)$/.test(s))return "ok";
    if(/^(1|true|yes)$/.test(s)&&/available|musait|free|bos|occupied/.test(key))
      return inverted?"busy":"ok";
    if(/^(0|false|no)$/.test(s)&&/available|musait|free|bos|occupied/.test(key))
      return inverted?"ok":"busy";
    return "";
  }
  function availabilityScan(o,depth=0,counts={ok:0,busy:0,off:0,total:0},seen={hit:false},inSocket=false){
    o=parseMaybe(o);
    if(!o||typeof o!=="object"||depth>8)return {counts,hit:seen.hit};
    if(Array.isArray(o)){o.forEach(x=>availabilityScan(x,depth+1,counts,seen,inSocket));return {counts,hit:seen.hit};}
    for(const k of Object.keys(o)){
      const v=parseMaybe(o[k]);
      if(v&&typeof v==="object"){availabilityScan(v,depth+1,counts,seen,inSocket||socketArrayKey(k));continue;}
      if(typeof v!=="string"&&typeof v!=="boolean"&&typeof v!=="number")continue;
      const cls=statusValue(v,k,inSocket);
      if(cls){seen.hit=true;counts.total++;counts[cls]++;}
    }
    return {counts,hit:seen.hit};
  }
  function availabilityCounts(o,depth=0,out={free:NaN,total:NaN,busy:NaN,off:NaN}){
    o=parseMaybe(o);if(!o||typeof o!=="object"||depth>8)return out;
    if(Array.isArray(o)){o.forEach(x=>availabilityCounts(x,depth+1,out));return out;}
    for(const k of Object.keys(o)){
      const v=parseMaybe(o[k]),key=normKey(k);
      if(v&&typeof v==="object"){availabilityCounts(v,depth+1,out);continue;}
      if(typeof v!=="number"&&typeof v!=="string")continue;
      const n=num(v);
      if(!Number.isFinite(n)||n<0||!Number.isInteger(n))continue;
      const isConnector=/soket|socket|unit|unite|connector|port/.test(key);
      const isCount=/sayisi|sayi|adet|count|number|num|total/.test(key);
      if(isConnector&&(/musait|kullanilabilir|available|free|bos/.test(key)))out.free=n;
      else if(isConnector&&(/dolu|mesgul|occupied|busy/.test(key)))out.busy=n;
      else if(isConnector&&(/ariza|bakim|fault|offline/.test(key)))out.off=n;
      else if(isConnector&&(/toplam|total|adet|sayisi|sayi|count|number|num/.test(key)))out.total=n;
      // Some connector summaries omit "socket" in the field name but include explicit counts.
      else if(isCount&&/^(availablecount|freecount|musaitadet|bosadet|availableports|freeports)$/.test(key))out.free=n;
    }
    return out;
  }
  function availabilitySummary(o){
    const scan=availabilityScan(o),c=scan.counts;
    const n=availabilityCounts(o);
    const total=Number.isFinite(n.total)&&n.total>0?n.total:NaN;
    const free=Number.isFinite(n.free)?Math.max(0,n.free):NaN;
    if(Number.isFinite(free)){
      if(free===0)return {key:"busy",label:"Müsait soket yok",counts:{...c,ok:0,total:Number.isFinite(total)?total:c.total},source:"socket-count"};
      return {key:"ok",label:Number.isFinite(total)&&free<total?free+"/"+total+" müsait": "Müsait",counts:{...c,ok:free,total:Number.isFinite(total)?total:Math.max(c.total,free)},source:"socket-count"};
    }
    if(Number.isFinite(total)&&Number.isFinite(n.busy)&&n.busy>=total)
      return {key:"busy",label:"Müsait soket yok",counts:{...c,busy:n.busy,total},source:"socket-count"};
    if(Number.isFinite(total)&&Number.isFinite(n.off)&&n.off>=total)
      return {key:"off",label:"Arızalı / bakım",counts:{...c,off:n.off,total},source:"socket-count"};
    if(!scan.hit||!c.total)return {key:"unknown",label:"Anlık soket bilgisi yok",counts:c,source:"not-provided"};
    if(c.ok>0)return {key:"ok",label:c.total>1?c.ok+"/"+c.total+" müsait":"Müsait",counts:c,source:"socket-status"};
    if(c.busy===c.total)return {key:"busy",label:"Müsait soket yok",counts:c,source:"socket-status"};
    if(c.off===c.total)return {key:"off",label:"Arızalı / bakım",counts:c,source:"socket-status"};
    if(c.busy>0)return {key:"busy",label:"Kısmen dolu",counts:c,source:"socket-status"};
    return {key:"unknown",label:"Anlık soket bilgisi yok",counts:c,source:"not-provided"};
  }
  function addPriceToPower(p,price){const base=String(p??"").trim();if(!Number.isFinite(price))return base;const priceText=`${price.toFixed(2)} TL/kWh`;if(base&&/TL\s*\/\s*kWh/i.test(base))return base;return base?`${base} · ${priceText}`:priceText}
  function enrichRow(raw,cols){
    const r=rowObject(raw,cols);
    const brand=firstValue(r,["sarjAgiIsletmecisiUnvan","sarjAgiIsletmecisi","isletmeciUnvan","isletmeci","operatorName","operator","company","markaAdi","marka","tescilliMarka","markaAd","sarjAgiMarka","sarjAgiIsletmecisiMarka","saglayiciMarka","operatorMarka","sarjIstasyonuIsletmecisiUnvan","sarjIstasyonuIsletmecisi","hizmetSaglayici","hizmetSaglayiciAdi"]);
    const brandText=String(brand||"").trim();
    if(brandText){r.marka=brandText;r.markaAdi=brandText;r.sarjAgiMarka=brandText;r.operator=brandText;r.operatorName=brandText;}
    const stationName=firstValue(r,["sarjIstasyonuAdi","istasyonAdi","istasyonAd","ad","name","stationName"]);
    if(brandText&&stationName&&!String(stationName).toLowerCase().startsWith(brandText.toLowerCase()))r.sarjIstasyonuAdi=`${brandText} · ${stationName}`;
    const availability=availabilitySummary(r);
    r.molavoltAvailability=availability;
    r.availabilityKey=availability.key;
    r.availabilityLabel=availability.label;
    r.availabilitySource=availability.source;
    const stationPrice=priceValue(r);
    if(Number.isFinite(stationPrice)){r.fiyat=stationPrice;r.fiyatTl=stationPrice;r.birimFiyat=stationPrice;r.birimFiyatTl=stationPrice;r.sarjHizmetiBirimFiyati=stationPrice;r.sarjHizmetiBirimFiyat=stationPrice;}
    const socketKey=["soketler","sockets","socketler","sarjSoketleri","sarjIstasyonuSoketleri","sarjUniteleri","soketBilgileri","soketBilgisi"].find(k=>r[k]!==undefined&&r[k]!==null);
    let sockets=socketKey?parseMaybe(r[socketKey]):[];if(!Array.isArray(sockets))sockets=sockets?[sockets]:[];
    if(sockets.length){r.soketler=sockets.map(rawSocket=>{const s=typeof rawSocket==="object"?{...rawSocket}:{soketTipi:String(rawSocket)};const p=Number.isFinite(priceValue(s))?priceValue(s):stationPrice;const pw=power(s);const st=socketType(s);if(st)s.soketTipi=st;if(pw||Number.isFinite(p))s.soketGucu=addPriceToPower(pw,p);if(Number.isFinite(p)){s.soketFiyati=p;s.birimFiyat=p;s.birimFiyatTl=p;s.fiyat=p;s.sarjHizmetiBirimFiyati=p;}return s})}
    else if(Number.isFinite(stationPrice))r.soketler=[{soketGucu:`${stationPrice.toFixed(2)} TL/kWh`,soketFiyati:stationPrice,birimFiyat:stationPrice,birimFiyatTl:stationPrice,fiyat:stationPrice}];
    return r;
  }
  function normalizeResponse(json){json=parseMaybe(json);const cols=getColumns(json);const rows=getRows(json);if(!rows.length)return json;const normalizedRows=rows.map(row=>enrichRow(row,cols));if(Array.isArray(json))return normalizedRows;if(json&&Array.isArray(json.result))return {...json,result:normalizedRows};if(json&&typeof json.result==="string")return {...json,result:normalizedRows};if(json&&json.result&&typeof json.result==="object")return {...json,result:{...json.result,rows:normalizedRows}};if(json&&Array.isArray(json.data))return {...json,data:normalizedRows};if(json&&typeof json.data==="string")return {...json,data:normalizedRows};if(json&&json.data&&typeof json.data==="object")return {...json,data:{...json.data,result:normalizedRows}};return{data:normalizedRows}}
  const attempts=[{label:"GET body boş obje",body:"{}"},{label:"GET body boş string",body:JSON.stringify("")},{label:"GET body string obje",body:JSON.stringify("{}")},{label:"GET body null alanlar",body:JSON.stringify({lisansNo:null,sarjIstasyonuAdi:null,sarjIstasyonuNo:null,markaAdi:null,yesilSarjIstasyonuMu:null,hizmetSekli:null})},{label:"GET body boş alanlar",body:JSON.stringify({lisansNo:"",sarjIstasyonuAdi:"",sarjIstasyonuNo:"",markaAdi:"",yesilSarjIstasyonuMu:"",hizmetSekli:""})}];
  const logs=[];for(const attempt of attempts){const r=await epdkRequest(attempt.body,attempt.label);const rowCount=getRows(r.json).length;logs.push({label:r.label,statusCode:r.statusCode,numRows:rowCount,sample:r.raw.slice(0,500)});if(r.statusCode===200&&rowCount>0)return res.status(200).send(JSON.stringify(normalizeResponse(r.json)))}
  return res.status(502).send(JSON.stringify({ok:false,error:"EPDK bağlantısı çalıştı ama istasyon verisi ayrıştırılamadı",note:"EPDK'nın güncel REST servisinden gelen iç içe/string JSON cevap formatları da denendi.",attempts:logs},null,2));
}
