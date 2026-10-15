// 列式数组格式：[cols, rows]，rows 中每行是字段值数组（与 cols 对齐）
let COLS=[], COL={}, ROWS=[];
function setCols(cols){ COLS=cols; COL={}; cols.forEach((n,i)=>COL[n]=i); }
function match(r, st){
  for(const f in st.text){
    const v=st.text[f]; if(!v) continue;
    const raw=v.split(/[+，,、]/).map(t=>t.trim()).filter(Boolean);
    if(!raw.length) continue;
    const field=String(r[COL[f]]||'').toLowerCase();
    const inc=[], exc=[];
    for(const t of raw){
      if(t[0]==='-'||t[0]==='－'){ const e=t.slice(1).toLowerCase(); if(e) exc.push(e); }
      else inc.push(t.toLowerCase());
    }
    if(inc.length && !inc.some(t=>field.includes(t))) return false;
    if(exc.some(t=>field.includes(t))) return false;
  }
  for(const f in st.filters){
    const set=st.filters[f];
    if(set && set.size && !set.has(r[COL[f]])) return false;
  }
  for(const f in st.num){
    const o=st.num[f]; if(!o) continue;
    const n=parseInt(r[COL[f]],10); if(isNaN(n)) return false;
    if(o.min!=='' && o.min!=null && n<parseInt(o.min,10)) return false;
    if(o.max!=='' && o.max!=null && n>parseInt(o.max,10)) return false;
  }
  return true;
}
function sortRes(res, key, dir){
  if(!key) return res;
  const ki=COL[key];
  return res.sort((a,b)=>{
    let x=parseInt(a[ki],10), y=parseInt(b[ki],10);
    if(!isNaN(x)&&!isNaN(y)) return (x-y)*dir;
    return String(a[ki]).localeCompare(String(b[ki]),'zh')*dir;
  });
}
self.onmessage = function(e){
  const m=e.data;
  if(m.type==='init'){
    fetch('jobs.json').then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
      .then(function(d){ setCols(d[0]); ROWS=d[1]; self.postMessage({type:'ready', total:ROWS.length, cols:COLS}); })
      .catch(function(err){ self.postMessage({type:'error', msg:String((err&&err.message)||err)}); });
    return;
  }
  if(m.type==='filter'){
    const st=m.state, page=m.page||1, pageSize=m.pageSize||50;
    let res=ROWS.filter(function(r){ return match(r, st); });
    res=sortRes(res, st.sortKey, st.sortDir);
    const seats=res.reduce(function(a,r){ return a+(parseInt(r[COL['招考人数']],10)||0); },0);
    const start=(page-1)*pageSize;
    const rows=res.slice(start, start+pageSize);
    self.postMessage({type:'result', count:res.length, seats:seats, page:page, pageSize:pageSize, rows:rows});
  }
};
