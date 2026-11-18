const test=require('node:test'),assert=require('node:assert/strict');
const {rowToEvent}=require('../calendar-parser');
test('Swiss calendar retains stadium, organizer and explicit deadline',()=>{
 const e=rowToEvent({headers:['Datum','Wettkampfname','Ort','Kanton','Stadion','Organisator','Meldeschluss'],cells:['01.02.2027','Hallenmeeting','Magglingen','BE','Halle End der Welt','ST Bern','25.01.2027']});
 assert.equal(e.stadium,'Halle End der Welt');assert.equal(e.organizer,'ST Bern');assert.equal(e.deadline,'25.01.2027');
});
test('Calendar headers may be reordered and unrelated dates are never deadlines',()=>{
 const e=rowToEvent({headers:['Datum','Wettkampfname','Ort','Organisator','Stadion','Kanton','Notiz'],cells:['01.02.2027','Meeting','Zug','LK Zug','Hertiallmend','ZG','Zeitplan vom 20.01.2027']});
 assert.equal(e.deadline,'');assert.equal(e.canton,'ZG');assert.equal(e.organizer,'LK Zug');
});
test('Indoor and non-sprint events are retained for transparent UI filtering',()=>{
 assert(rowToEvent(['01.02.2027','Hallenmeeting Sprint','Basel','BS','Halle','LC Basel','']));
 assert(rowToEvent(['01.02.2027','Stab Meeting','Basel','BS','Halle','LC Basel','']));
 assert.equal(rowToEvent(['kein Datum','Meeting','Basel']),null);
});
