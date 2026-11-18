// Swiss Athletics calendar columns; retain source values without inferring deadlines.
const CANTONS=new Set('ZH BE LU UR SZ OW NW GL ZG FR SO BS BL SH AR AI SG GR AG TG TI VD VS NE GE JU'.split(' '));
function rowToEvent(row){
  const cells=Array.isArray(row)?row:row.cells||[],headers=Array.isArray(row)?[]:row.headers||[];
  const column=(re,fallback=-1)=>{const i=headers.findIndex(h=>re.test(h));return String(cells[i>=0?i:headers.length?-1:fallback]||'').trim();};
  const rawDate=column(/^Datum/i,0),dm=rawDate.match(/(\d{2}\.\d{2}\.\d{4})/);
  if(!dm)return null;
  const name=column(/Wettkampfname/i,1),venue=column(/^Ort\b/i,2);
  if(name.length<3)return null;
  const date=dm[1],endDate=[...rawDate.matchAll(/\d{2}\.\d{2}\.\d{4}/g)][1]?.[0]||'',canton=column(/^Kanton/i,3).toUpperCase();
  // The seven columns are also verified in the public Swiss Athletics calendar.
  const stadium=column(/Stadion|Wettkampfstätte|Sportanlage/i,cells.length>=7?4:-1);
  const organizer=column(/Organisator|Veranstalter/i,cells.length>=7?5:-1);
  const deadlineText=column(/Meldeschluss|Anmeldefrist/i,cells.length>=7?6:-1);
  const deadline=deadlineText.match(/\d{2}\.\d{2}\.\d{4}/)?.[0]||'';
  const program=column(/Disziplin/i);
  const detailsUrl=(row.links||[]).find(x=>/details|wettkampf|ausschreibung/i.test(x.label||'')&&/^https:\/\//i.test(x.href||''))?.href||'';
  const parts=date.split('.'),iso=parts.reverse().join('-');
  return {date,endDate,name,venue,canton:CANTONS.has(canton)?canton:'',stadium,organizer,deadline,disciplines:program||'',detailsUrl,past:iso<new Date().toISOString().slice(0,10)};
}
module.exports={rowToEvent};
