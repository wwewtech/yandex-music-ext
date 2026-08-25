// Verify tags presence and ALL chunk offsets in a tagged file
const fs = require('fs');
const b = fs.readFileSync(process.argv[2] || 'scripts/new_dl.flac');
const u = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
const s = Buffer.from(u).toString('latin1');
console.log('ilst string present:', s.includes('ilst'));
console.log('covr present:', s.includes('covr'));
console.log('title tag (\u00A9nam):', s.includes('\u00A9nam'));

// locate moov/mdat
let moovOff=-1, moovSize=0, mdatOff=-1;
for (let off=0; off+8<=u.length;) {
    const sz=dv.getUint32(off); const nm=String.fromCharCode(u[off+4],u[off+5],u[off+6],u[off+7]);
    if(nm==='moov'){moovOff=off;moovSize=sz;} if(nm==='mdat'){mdatOff=off;break;} if(sz<8)break; off+=sz;
}
console.log('moov @'+moovOff+' size='+moovSize, '| mdat @'+mdatOff);

// recursive stco scan
const refs=[];
(function scan(start,end){
    let o=start;
    while(o+8<=end){
        const sz=dv.getUint32(o); const nm=String.fromCharCode(u[o+4],u[o+5],u[o+6],u[o+7]);
        if(sz<8||o+sz>end)return;
        if(nm==='stco')refs.push({tableOff:o+12,count:dv.getUint32(o+8)});
        else if(['moov','trak','mdia','minf','stbl'].includes(nm))scan(o+8,o+sz);
        o+=sz;
    }
})(moovOff+8,moovOff+moovSize);
let total=0,bad=0;
for(const r of refs){
    for(let i=0;i<r.count;i++){
        const v=dv.getUint32(r.tableOff+i*4); total++;
        const ok=v>mdatOff && u[v]===0xFF && (u[v+1]&0xFC)===0xF8;
        if(!ok){bad++; if(bad<=3)console.log('BAD offset',v,'bytes:',Array.from(u.slice(v,v+4)).map(x=>x.toString(16)).join(' '));}
    }
}
console.log('chunk offsets: total='+total, 'bad='+bad);