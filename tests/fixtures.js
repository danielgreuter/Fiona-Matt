const fs=require('node:fs');
const fixtures={
  weather:JSON.parse(fs.readFileSync('tests/fixtures/dakar-weather.json','utf8')),
  'sa-results':JSON.parse(fs.readFileSync('athlete_results.json','utf8')),
  'bestenliste':{disciplines:{'100m':{year:'2026',top15:[{rank:1,name:'Runner A',result:'11.90',venue:'Basel',comp_date:'09.05.2026'}],fiona:{rank:2,result:'12.03'}}}},
  'wa-pbs':{pbs:[{discipline:'100 Metres',result:'12.03',score:986,date:'09 MAY 2026'}]},
  'results':JSON.parse(fs.readFileSync('tests/fixtures/wa-results.json','utf8')),
  'lieteam':JSON.parse(fs.readFileSync('tests/fixtures/lie-team.json','utf8')),
  'calendar':[{id:17,name:'WK: Dakar',date:'08.11.2026',isWettkampf:true,venue:'Dakar',fionaStarting:true,disciplines:['100m']},{id:'training1',name:'Max Velocity',date:'03.10.2026',isWettkampf:false,comment:'Wickets + 3 x fly 20 m'}],
  'chcalendar':{events:[{name:'Swiss Meeting',date:'01.12.2026',venue:'Magglingen'}]},
  'upcoming':{events:[]},
  'athlete':{results:[{discipline:'100 Metres',date:'09 MAY 2026',result:'12.03',score:986,venue:'Basel'}]}
};
module.exports=fixtures;
