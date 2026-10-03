const fs=require('node:fs');
const fixtures={
  'sa-results':JSON.parse(fs.readFileSync('athlete_results.json','utf8')),
  'bestenliste':{disciplines:{'100m':{year:'2026',top15:[{rank:1,name:'Runner A',result:'11.90',venue:'Basel',comp_date:'09.05.2026'}],fiona:{rank:2,result:'12.03'}}}},
  'wa-pbs':{pbs:[{discipline:'100 Metres',result:'12.03',score:986,date:'09 MAY 2026'}]},
  'results':[{discipline:'100 Metres',result:'12.03',score:986,date:'09 MAY 2026',wind:'1.0',venue:'Basel'}],
  'lieteam':{'Fiona Matt':{discs:[{name:'100 Metres',score:986,result:'12.03'}]},'Julia Rohrer':{discs:[{name:'100 Metres',score:970,result:'12.10'}]}},
  'calendar':[{id:17,name:'WK: Dakar',date:'08.11.2026',isWettkampf:true,venue:'Dakar',fionaStarting:true,disciplines:['100m']},{id:'training1',name:'Max Velocity',date:'03.10.2026',isWettkampf:false,comment:'Wickets + 3 x fly 20 m'}],
  'chcalendar':{events:[{name:'Swiss Meeting',date:'01.12.2026',venue:'Magglingen'}]},
  'upcoming':{events:[]},
  'athlete':{results:[{discipline:'100 Metres',date:'09 MAY 2026',result:'12.03',score:986,venue:'Basel'}]}
};
module.exports=fixtures;
