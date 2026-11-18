(() => {
  const M=window.FionaModels,H=window.FIONA_HISTORICAL;
  const sources={};
  let calendarRefresh=null;
  const openTrainingDetails=new Set();
  let saResults=[];
  const teamProfiles={},teamPending={};
  let teamLoading=false,profileMetadata={},rosterOpen=false;
  const state={rankDisc:'100m',rankYear:'2026',waDisc:'100m',waYear:'Alle',teamDisc:'Alle',teamGender:'Alle',calendarSource:'Fiona',calendarSearch:'',calendarPeriod:'Kommende',sprintOpen:false,sprintDiscipline:'Alle',sprintSearch:'',weekOffset:0};
  const $=s=>document.querySelector(s);
  const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=String(text);if(cls)e.className=cls;return e;};
  const button=(label,callback,cls='tab')=>{const b=node('button',label,cls);b.type='button';b.onclick=callback;return b;};
  function select(label,values,value,change){const wrap=node('label',null,'control');wrap.append(node('span',label));const s=node('select',null,'select');for(const [v,l] of values.map(x=>Array.isArray(x)?x:[x,x])){const o=node('option',l);o.value=v;s.append(o);}s.value=value;s.onchange=()=>change(s.value);wrap.append(s);return wrap;}
  const discs=[['60m','60 m'],['100m','100 m'],['150m','150 m'],['200m','200 m'],['Long Jump','Weitsprung']];
  const value=(r)=>r?.result||r?.mark||'—';
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Vaduz',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const safeLink=(label,url)=>{const a=node('a',label,'tab');try{const u=new URL(url);if(u.protocol!=='https:')return node('span',label);a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';}catch{return node('span',label);}return a;};
  const card=(title,sub)=>{const c=node('section',null,'card');c.append(node('h2',title));if(sub)c.append(node('p',sub,'card-sub'));return c;};
  function status(parent,action){const r=sources[action];const refresh=button('↻ Aktualisieren',async()=>{if(action==='calendar')await refreshCalendar();else await window.FionaSources.loadOne(action,{force:true});});refresh.disabled=action==='calendar'&&!!calendarRefresh;parent.append(refresh);if(action==='calendar'&&calendarRefresh)parent.append(node('p','Kalender wird aktualisiert …','data-note')); parent.append(node('p',!r?'Quelle wird geladen …':r.status==='live'?'Quelle erreichbar · Abruf '+new Date(r.loadedAt).toLocaleString('de-CH'):r.status==='cache'?'Gespeicherter Abruf '+new Date(r.loadedAt).toLocaleString('de-CH')+' · Live-Quelle nicht erreichbar':'Live-Quelle nicht erreichbar · kein aktueller Abruf','data-note'));}
  function table(parent,headers,rows){const wrap=node('div',null,'table-wrap');const t=node('table',null,'data-table');const head=node('thead');const tr=node('tr');headers.forEach(h=>tr.append(node('th',h)));head.append(tr);t.append(head);const body=node('tbody');for(const item of rows){const r=node('tr');if(item.fiona)r.className='fiona-row';for(const cell of item.cells){const td=node('td');if(cell instanceof Element)td.append(cell);else td.textContent=String(cell??'—');r.append(td);}body.append(r);}t.append(body);wrap.append(t);parent.append(wrap);}
  function dateLabel(e){return e.date||e.start?.dateTime||e.start?.date||'';}
  function details(parent,record){const d=node('details');d.append(node('summary','Vollständige Details'),node('pre',JSON.stringify(record,null,2)));parent.append(d);}
  function openDetail(title){const dialog=$('#resultDetail');const body=$('#detailContent');body.classList.remove('team-result-detail');body.replaceChildren(node('h2',title));$('#closeDetail').onclick=()=>dialog.close();dialog.showModal();return body;}
  function renderRankings(){
    const root=$('#rankingsContent'),c=card('Schweiz / Liechtenstein · U18 Frauen','Historische Listen bleiben separat von aktuellen Saisonlisten.');
    const controls=node('div',null,'filters');controls.append(select('Disziplin',discs,state.rankDisc,v=>{state.rankDisc=v;renderRankings();}),select('Saison',['2026','2025','2024'],state.rankYear,v=>{state.rankYear=v;renderRankings();}));c.append(controls);status(c,'bestenliste');
    const rank=M.ranking(sources.bestenliste?.data,H.athlete,state.rankDisc,state.rankYear);
    if(rank.historical)c.append(node('p','Historischer eingebetteter V1-Stand · kein aktueller Rangnachweis','badge info'));
    if(rank.fiona)c.append(node('h3','Fiona · Rang '+(rank.fiona.rank||'nicht verfügbar')+' · '+value(rank.fiona)));
    if(rank.gapAhead)c.append(node('p','Abstand zu '+rank.ahead.name+' (Rang '+rank.ahead.rank+'): '+rank.gapAhead+(state.rankDisc==='Long Jump'?' m':' s')));
    if(rank.gapBehind)c.append(node('p','Vorsprung gegenüber '+rank.behind.name+': '+rank.gapBehind+(state.rankDisc==='Long Jump'?' m':' s')));
    if(rank.rows.length)table(c,['Rang','Athletin / Verein','Jahrgang','Leistung','Wind','Ort / Datum'],rank.rows.map(r=>{const isFiona=M.isFionaName(r.name)||r.isFiona||r.fiona;const person=node('div',null,'ranking-person');person.append(node('strong',r.name,'ranking-name'));if(r.club)person.append(node('span',r.club,'ranking-club'));const born=M.birthYear(r.born||r.birthDate||r.birthYear)||(isFiona?M.birthYear(window.FIONA_APP_CONFIG.athlete.birthDate):'');return{fiona:isFiona,cells:[r.rank,person,born||'—',value(r),r.wind??'—',[r.location||r.venue,r.date||r.comp_date].filter(Boolean).join(' · ')]};}));
    else c.append(node('p','Für diese Kombination sind keine Rangdaten vorhanden.'));
    root.replaceChildren(c);
  }
  function drawScoreChart(parent,rows,large=false){
    if(!rows.length){parent.append(node('p','Keine WA-Punkte für diesen Zeitraum.'));return;}
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),width=760,height=large?360:250,pad=45;
    svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('role','img');svg.setAttribute('aria-label','WA-Punkte im Zeitverlauf; höhere Werte stehen für mehr Punkte');svg.classList.add('score-chart');
    const ys=rows.map(r=>r.score),min=Math.min(...ys)-15,max=Math.max(...ys)+15;
    const times=rows.map(r=>Date.parse(r.dateISO+'T00:00:00Z'));const lo=Math.min(...times),hi=Math.max(...times);
    const x=i=>pad+(hi===lo?0.5:(times[i]-lo)/(hi-lo))*(width-2*pad),y=v=>height-pad-(v-min)/(max-min)*(height-2*pad);
    for(const v of [min,(min+max)/2,max]){const line=document.createElementNS(ns,'line');for(const [key,val] of Object.entries({x1:pad,x2:width-pad,y1:y(v),y2:y(v),stroke:'#e3e8f2'}))line.setAttribute(key,val);svg.append(line);const text=document.createElementNS(ns,'text');text.setAttribute('x',2);text.setAttribute('y',y(v)+4);text.setAttribute('fill','#66758c');text.textContent=Math.round(v);svg.append(text);}
    const path=document.createElementNS(ns,'path');path.setAttribute('d',rows.map((r,i)=>`${i?'L':'M'}${x(i)},${y(r.score)}`).join(' '));path.setAttribute('stroke','#2563eb');path.setAttribute('fill','none');path.setAttribute('stroke-width','3');svg.append(path);
    const bestIndex=rows.findIndex(r=>r.score===Math.max(...ys));const best=rows[bestIndex];const bestLabel=document.createElementNS(ns,'text');bestLabel.setAttribute('x',Math.min(width-pad,Math.max(pad,x(bestIndex))));bestLabel.setAttribute('y',Math.max(20,y(best.score)-15));bestLabel.setAttribute('text-anchor',x(bestIndex)>width/2?'end':'start');bestLabel.setAttribute('fill','#1e3a8a');bestLabel.setAttribute('font-weight','700');bestLabel.textContent=best.score+' Punkte · '+resultLabel({...best,discipline:state.waDisc});svg.append(bestLabel);
    rows.forEach((r,i)=>{const dot=document.createElementNS(ns,'circle');for(const [k,v] of Object.entries({cx:x(i),cy:y(r.score),r:5,fill:r.origin==='World Athletics'?'#2563eb':'#dc2626'}))dot.setAttribute(k,v);const title=document.createElementNS(ns,'title');title.textContent=r.date+' · '+resultLabel({...r,discipline:state.waDisc})+' · '+r.score+' Punkte · Wind '+windLabel(r)+' · '+r.origin;dot.append(title);dot.setAttribute('tabindex','0');dot.setAttribute('role','button');dot.setAttribute('aria-label',title.textContent);dot.onclick=()=>waResultDetail({...r,discipline:state.waDisc});dot.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();dot.onclick();}};svg.append(dot);});
    for(const i of [...new Set([0,Math.floor((rows.length-1)/2),rows.length-1])]){const label=document.createElementNS(ns,'text');label.setAttribute('x',x(i));label.setAttribute('y',height-10);label.setAttribute('text-anchor',i===0?'start':i===rows.length-1?'end':'middle');label.setAttribute('fill','#66758c');label.textContent=rows[i].dateISO;svg.append(label);}
    parent.append(svg);parent.append(node('p',rows[0].date+' → '+rows[rows.length-1].date+' · Abgerufene WA-Einzelresultate · Punkt antippen für Zeit und Wind','data-note'));
  }
  function waBrand(parent){const a=safeLink('','https://worldathletics.org/');a.className='wa-source-brand';const img=node('img');img.src='./assets/world-athletics-logo.svg';img.alt='World Athletics';img.width=180;img.height=40;a.append(img,node('span','Datenquelle'));parent.append(a);}
  const waResults=()=>{const data=sources.results?.data;return Array.isArray(data)?data:data?.results||[];};
  function isIndoor(r){
    return r.indoor===true||/\(i\)|indoor|short track|\bhalle\b/i.test([r.discipline,r.venue,r.competition].join(' '));
  }
  function windLabel(r){
    if(isIndoor(r))return 'Indoor';
    if(r.wind==null||String(r.wind).trim()==='')return 'nicht angegeben';
    const w=M.number(r.wind);return Number.isFinite(w)?(w>0?'+':'')+w.toFixed(1)+' m/s'+(w>2?' · windunterstützt':''):String(r.wind);
  }
  function resultLabel(r){const v=value(r);return v==='—'?v:v+(/Jump|Weitsprung|Throw|Put|Hoch|Speer|Kugel|Diskus/.test(r.discipline||r.name||'')?' m':' s');}
  function waPointsLabel(r,missing='—'){
    if(r.tablePoints!=null){
      const label=r.tablePoints+' · Tabelle';
      return M.number(r.score)>0?r.score+' · WA / '+label:label;
    }
    return M.number(r.score)>0?String(r.score):missing;
  }
  function pbWithWind(pb,list){
    if(isIndoor(pb)||String(pb.wind??'').trim())return pb;
    const date=M.dateKey(pb.date),mark=M.number(value(pb));
    const matches=list.filter(r=>date&&M.dateKey(r.dateISO||r.date)===date&&M.discipline(r.discipline)===M.discipline(pb.discipline)&&M.number(value(r))===mark);
    const readings=[...new Set(matches.map(r=>isIndoor(r)?'Indoor':M.number(r.wind)).filter(w=>w==='Indoor'||Number.isFinite(w)))];
    return readings.length===1?readings[0]==='Indoor'?{...pb,indoor:true}:{...pb,wind:readings[0]}:pb;
  }
  function waResultDetail(r){const body=openDetail(state.waDisc+' · '+resultLabel(r));table(body,['Merkmal','Wert'],[['Datum',r.date],['Leistung',resultLabel(r)],['WA-Punkte',waPointsLabel(r,'nicht geliefert')],['Wind',windLabel(r)],['Lauf / Rang',M.raceLabel(r.place)],['Wettkampf',r.competition||'—'],['Ort',r.venue||'—'],['Quelle',r.origin||'World Athletics']].map(cells=>({cells})));waBrand(body);}
  // World Athletics Scoring Tables 2025, Women's Sprints I, outdoor 100m.
  // Keys are electronic race times in hundredths of a second.
  const wa100Table={
    1012:1400,1013:1397,1014:1395,1015:1392,1016:1390,1017:1388,1018:1385,1019:1383,1020:1381,1021:1378,
    1022:1376,1023:1374,1024:1371,1025:1369,1026:1367,1027:1364,1028:1362,1029:1360,1030:1357,1031:1355,
    1032:1353,1033:1350,1034:1348,1035:1346,1036:1344,1037:1341,1038:1339,1039:1337,1040:1334,1041:1332,
    1042:1330,1043:1327,1044:1325,1045:1323,1046:1321,1047:1318,1048:1316,1049:1314,1050:1311,1051:1309,
    1052:1307,1053:1305,1054:1302,1055:1300,1056:1298,1057:1295,1058:1293,1059:1291,1060:1289,1061:1286,
    1062:1284,1063:1282,1064:1280,1065:1277,1066:1275,1067:1273,1068:1271,1069:1268,1070:1266,1071:1264,
    1072:1262,1073:1259,1074:1257,1075:1255,1076:1253,1077:1251,1078:1248,1079:1246,1080:1244,1081:1242,
    1082:1239,1083:1237,1084:1235,1085:1233,1086:1231,1087:1228,1088:1226,1089:1224,1090:1222,1091:1220,
    1092:1217,1093:1215,1094:1213,1095:1211,1096:1209,1097:1206,1098:1204,1099:1202,1100:1200,1101:1198,
    1102:1195,1103:1193,1104:1191,1105:1189,1106:1187,1107:1185,1108:1182,1109:1180,1110:1178,1111:1176,
    1112:1174,1113:1172,1114:1169,1115:1167,1116:1165,1117:1163,1118:1161,1119:1159,1120:1157,1121:1154,
    1122:1152,1123:1150,1124:1148,1125:1146,1126:1144,1127:1142,1128:1139,1129:1137,1130:1135,1131:1133,
    1132:1131,1133:1129,1134:1127,1135:1125,1136:1123,1137:1120,1138:1118,1139:1116,1140:1114,1141:1112,
    1142:1110,1143:1108,1144:1106,1145:1104,1146:1102,1147:1099,1148:1097,1149:1095,1150:1093,1151:1091,
    1152:1089,1153:1087,1154:1085,1155:1083,1156:1081,1157:1079,1158:1077,1159:1075,1160:1072,1161:1070,
    1162:1068,1163:1066,1164:1064,1165:1062,1166:1060,1167:1058,1168:1056,1169:1054,1170:1052,1171:1050,
    1172:1048,1173:1046,1174:1044,1175:1042,1176:1040,1177:1038,1178:1036,1179:1034,1180:1032,1181:1030,
    1182:1028,1183:1026,1184:1023,1185:1021,1186:1019,1187:1017,1188:1015,1189:1013,1190:1011,1191:1009,
    1192:1007,1193:1005,1194:1003,1195:1001,1196:999,1197:997,1198:995,1199:993,1201:990,1202:988,
    1203:986,1204:984,1205:982,1206:980,1207:978,1208:976,1209:974,1210:972,1211:970,1212:968,
    1213:966,1214:964,1215:962,1216:960,1217:958,1218:956,1219:954,1220:952,1221:950,1222:948,
    1223:946,1224:944,1225:943,1226:941,1227:939,1228:937,1229:935,1230:933,1231:931,1232:929,
    1233:927,1234:925,1235:923,1236:921,1237:919,1238:918,1239:916,1240:914,1241:912,1242:910,
    1243:908,1244:906,1245:904,1246:902,1247:900,1248:899,1249:897,1250:895,1251:893,1252:891,
    1253:889,1254:887,1255:885,1256:884,1257:882,1258:880,1259:878,1260:876,1261:874,1262:872,
    1263:870,1264:869,1265:867,1266:865,1267:863,1268:861,1269:859,1270:857,1271:856,1272:854,
    1273:852,1274:850,1275:848,1276:846,1277:845,1278:843,1279:841,1280:839,1281:837,1282:835,
    1283:834,1284:832,1285:830,1286:828,1287:826,1288:825,1289:823,1290:821,1291:819,1292:817,
    1293:816,1294:814,1295:812,1296:810,1297:808,1298:807,1299:805,1300:803,1301:801,1302:799,
    1303:798,1304:796,1305:794,1306:792,1307:791,1308:789,1309:787,1310:785,1311:783,1312:782,
    1313:780,1314:778,1315:776,1316:775,1317:773,1318:771,1319:769,1320:768,1321:766,1322:764,
    1323:762,1324:761,1325:759,1326:757,1327:756,1328:754,1329:752,1330:750,1331:749,1332:747,
    1333:745,1334:743,1335:742,1336:740,1337:738,1338:737,1339:735,1340:733,1341:731,1342:730,
    1343:728,1344:726,1345:725,1346:723,1347:721,1348:720,1349:718,1350:716,1351:715,1352:713,
    1353:711,1354:709,1355:708,1356:706,1357:704,1358:703,1359:701,1360:699,1361:698,1362:696,
    1363:694,1364:693,1365:691,1366:689,1367:688,1368:686,1369:685,1370:683,1371:681,1372:680,
    1373:678,1374:676,1375:675,1376:673,1377:671,1378:670,1379:668,1380:667,1381:665,1382:663,
    1383:662,1384:660,1385:658,1386:657,1387:655,1388:654,1389:652,1390:650,1391:649,1392:647,
    1393:646,1394:644,1395:642,1396:641,1397:639,1398:638,1399:636,1400:634,1401:633,1402:631,
    1403:630,1404:628,1405:626,1406:625,1407:623,1408:622,1409:620,1410:619,1411:617,1412:615,
    1413:614,1414:612,1415:611,1416:609,1417:608,1418:606,1419:605,1420:603,1421:601,1422:600,
    1423:598,1424:597,1425:595,1426:594,1427:592,1428:591,1429:589,1430:588,1431:586,1432:585,
    1433:583,1434:582,1435:580,1436:579,1437:577,1438:575,1439:574,1440:572,1441:571,1442:569,
    1443:568,1444:566,1445:565,1446:563,1447:562,1448:560,1449:559,1450:557,1451:556,1452:555,
    1453:553,1454:552,1455:550,1456:549,1457:547,1458:546,1459:544,1460:543,1461:541,1462:540,
    1463:538,1464:537,1465:535,1466:534,1467:532,1468:531,1469:530,1470:528,1471:527,1472:525,
    1473:524,1474:522,1475:521,1476:519,1477:518,1478:517,1479:515,1480:514,1481:512,1482:511,
    1483:509,1484:508,1485:507,1486:505,1487:504,1488:502,1489:501,1490:500,1491:498,1492:497,
    1493:495,1494:494,1495:493,1496:491,1497:490,1498:488,1499:487,1500:486,1501:484,1502:483,
    1503:481,1504:480,1505:479,1506:477,1507:476,1508:475,1509:473,1510:472,1511:470,1512:469,
    1513:468,1514:466,1515:465,1516:464,1517:462,1518:461,1519:460,1520:458,1521:457,1522:456,
    1523:454,1524:453,1525:451,1526:450,1527:449,1528:447,1529:446,1530:445,1531:443,1532:442,
    1533:441,1534:440,1535:438,1536:437,1537:436,1538:434,1539:433,1540:432,1541:430,1542:429,
    1543:428,1544:426,1545:425,1546:424,1547:422,1548:421,1549:420,1550:419,1551:417,1552:416,
    1553:415,1554:413,1555:412,1556:411,1557:410,1558:408,1559:407,1560:406,1561:405,1562:403,
    1563:402,1564:401,1565:399,1566:398,1567:397,1568:396,1569:394,1570:393,1571:392,1572:391,
    1573:389,1574:388,1575:387,1576:386,1577:385,1578:383,1579:382,1580:381,1581:380,1582:378,
    1583:377,1584:376,1585:375,1586:373,1587:372,1588:371,1589:370,1590:369,1591:367,1592:366,
    1593:365,1594:364,1595:363,1596:361,1597:360,1598:359,1599:358,1600:357,1601:355,1602:354,
    1603:353,1604:352,1605:351,1606:350,1607:348,1608:347,1609:346,1610:345,1611:344,1612:342,
    1613:341,1614:340,1615:339,1616:338,1617:337,1618:336,1619:334,1620:333,1621:332,1622:331,
    1623:330,1624:329,1625:327,1626:326,1627:325,1628:324,1629:323,1630:322,1631:321,1632:320,
    1633:318,1634:317,1635:316,1636:315,1637:314,1638:313,1639:312,1640:311,1641:309,1642:308,
    1643:307,1644:306,1645:305,1646:304,1647:303,1648:302,1649:301,1650:300,1651:298,1652:297,
    1653:296,1654:295,1655:294,1656:293,1657:292,1658:291,1659:290,1660:289,1661:288,1662:287,
    1663:286,1664:284,1665:283,1666:282,1667:281,1668:280,1669:279,1670:278,1671:277,1672:276,
    1673:275,1674:274,1675:273,1676:272,1677:271,1678:270,1679:269,1680:268,1681:267,1682:266,
    1683:265,1684:264,1685:263,1686:262,1687:261,1688:260,1689:259,1690:258,1691:257,1692:255,
    1693:254,1694:253,1695:252,1696:251,1697:250,1698:249,1700:248,1701:247,1702:246,1703:245,
    1704:244,1705:243,1706:242,1707:241,1708:240,1709:239,1710:238,1711:237,1712:236,1713:235,
    1714:234,1715:233,1716:232,1717:231,1718:230,1719:229,1720:228,1721:227,1722:226,1723:225,
    1724:224,1725:223,1726:222,1728:221,1729:220,1730:219,1731:218,1732:217,1733:216,1734:215,
    1735:214,1736:213,1737:212,1738:211,1739:210,1740:209,1742:208,1743:207,1744:206,1745:205,
    1746:204,1747:203,1748:202,1749:201,1750:200,1752:199,1753:198,1754:197,1755:196,1756:195,
    1757:194,1758:193,1760:192,1761:191,1762:190,1763:189,1764:188,1765:187,1766:186,1768:185,
    1769:184,1770:183,1771:182,1772:181,1774:180,1775:179,1776:178,1777:177,1778:176,1779:175,
    1781:174,1782:173,1783:172,1784:171,1786:170,1787:169,1788:168,1789:167,1790:166,1792:165,
    1793:164,1794:163,1795:162,1797:161,1798:160,1799:159,1800:158,1802:157,1803:156,1804:155,
    1805:154,1807:153,1808:152,1809:151,1811:150,1812:149,1813:148,1815:147,1816:146,1817:145,
    1818:144,1820:143,1821:142,1822:141,1824:140,1825:139,1827:138,1828:137,1829:136,1831:135,
    1832:134,1833:133,1835:132,1836:131,1837:130,1839:129,1840:128,1842:127,1843:126,1845:125,
    1846:124,1847:123,1849:122,1850:121,1852:120,1853:119,1855:118,1856:117,1858:116,1859:115,
    1861:114,1862:113,1863:112,1865:111,1867:110,1868:109,1870:108,1871:107,1873:106,1874:105,
    1876:104,1877:103,1879:102,1880:101,1882:100,1884:99,1885:98,1887:97,1888:96,1890:95,
    1892:94,1893:93,1895:92,1897:91,1898:90,1900:89,1902:88,1903:87,1905:86,1907:85,
    1909:84,1910:83,1912:82,1914:81,1916:80,1917:79,1919:78,1921:77,1923:76,1925:75,
    1926:74,1928:73,1930:72,1932:71,1934:70,1936:69,1938:68,1940:67,1942:66,1944:65,
    1945:64,1947:63,1950:62,1952:61,1954:60,1956:59,1958:58,1960:57,1962:56,1964:55,
    1966:54,1968:53,1971:52,1973:51,1975:50,1977:49,1980:48,1982:47,1984:46,1987:45,
    1989:44,1991:43,1994:42,1996:41,1999:40,2001:39,2004:38,2006:37,2009:36,2012:35,
    2014:34,2017:33,2020:32,2023:31,2026:30,2029:29,2031:28,2035:27,2038:26,2041:25,
    2044:24,2047:23,2051:22,2054:21,2058:20,2061:19,2065:18,2069:17,2072:16,2077:15,
    2081:14,2085:13,2090:12,2094:11,2099:10,2104:9,2110:8,2115:7,2122:6,2129:5,
    2136:4,2145:3,2155:2,2168:1
  };
  function wa100Mark(r){
    const mark=String(value(r)).trim().replace(',','.').match(/^(\d+\.\d{2})(?=$|[\s*])/);
    return mark?Math.round(Number(mark[1])*100):null;
  }
  function newerWaPoints(r,pbs){
    if(M.discipline(r.discipline)!=='100m'||isIndoor(r))return {score:null};
    const mark=wa100Mark(r),tablePoints=wa100Table[mark]??null;
    const date=M.dateKey(r.dateISO||r.date);
    const matches=(pbs||[]).filter(p=>M.discipline(p.discipline)==='100m'&&M.dateKey(p.dateISO||p.date)===date&&wa100Mark(p)===mark);
    const scores=[...new Set(matches.map(p=>M.number(p.score)).filter(n=>n>0))];
    return {score:scores.length===1?scores[0]:null,tablePoints};
  }
  function renderWA(){
    const root=$('#waContent'),c=card('WA-Punkte & Entwicklung','Leistungswerte pro Resultat · Zeit, Wind und Wettkampf im direkten Vergleich.');waBrand(c);
    const controls=node('div',null,'filters');controls.append(select('Disziplin',discs,state.waDisc,v=>{state.waDisc=v;renderWA();}),select('Zeitraum',['Alle','2026','2025','2024'],state.waYear,v=>{state.waYear=v;renderWA();}));c.append(controls);status(c,'results');
    const pbs=sources.results?.data?.pbs||sources['wa-pbs']?.data?.pbs;
    const live=waResults(),latest=live.filter(r=>M.discipline(r.discipline||r.name)===state.waDisc).map(r=>M.dateKey(r.date)).filter(Boolean).sort().at(-1);
    if(latest)c.append(node('p','Neuester Einzelresultat-Eintrag der WA-Quelle: '+latest+' · Ein erfolgreicher Abruf bestätigt keinen vollständigen Saisonbestand.','data-note'));
    const raw=M.scoreRows(live,[],state.waDisc);
    const rows=raw.filter(r=>r.dateISO&&(state.waYear==='Alle'||r.dateISO.startsWith(state.waYear)));
    const filtered=live.filter(r=>M.discipline(r.discipline||r.name)===state.waDisc&&(state.waYear==='Alle'||M.dateKey(r.date).startsWith(state.waYear))).map(r=>({...r,origin:'World Athletics'}));
    const showTable=(parent,list)=>table(parent,['Wettkampfdatum','Ort','Zeit / Leistung','WA-Punkte','Wind','Wettkampf'],list.map(r=>({cells:[r.date,r.venue||'—',button(resultLabel(r),()=>waResultDetail(r),'athlete-link'),waPointsLabel(r),windLabel(r),r.competition||'—']})));
    c.append(button('Chart vergrössern',()=>{const body=openDetail(state.waDisc+' · WA-Punkte');waBrand(body);drawScoreChart(body,rows,true);showTable(body,M.resultTableRows(filtered));}));drawScoreChart(c,rows);
    c.append(node('h3','Beste 5 Resultate nach WA-Punkten'));
    const top=filtered.filter(r=>M.number(r.score)>0).sort((a,b)=>b.score-a.score||M.dateKey(b.date).localeCompare(M.dateKey(a.date))).slice(0,5);
    if(top.length)showTable(c,top);else c.append(node('p','Keine WA-Einzelresultate mit Punkten für diesen Filter verfügbar.'));
    c.append(node('h3','Alle WA-Einzelresultate · '+state.waDisc));
    if(filtered.length)showTable(c,M.resultTableRows(filtered));else c.append(node('p','Keine Einzelresultate von der Quelle geliefert.'));
    const newer=saResults.filter(r=>M.discipline(r.discipline)===state.waDisc&&M.dateKey(r.dateISO||r.date)> (latest||'')&&(state.waYear==='Alle'||M.dateKey(r.dateISO||r.date).startsWith(state.waYear))).sort((a,b)=>M.dateKey(b.dateISO||b.date).localeCompare(M.dateKey(a.dateISO||a.date)));
    if(newer.length){c.append(node('h3','Neuere Resultate · Swiss Athletics'));c.append(node('p','«Tabelle» zeigt die 100-m-Punkte nach der WA-Tabelle 2025 ohne Windkorrektur. «WA» bezeichnet einen veröffentlichten Score aus der passenden WA-Bestleistung.','data-note'));showTable(c,M.resultTableRows(newer).map(r=>{
      return {...r,...newerWaPoints(r,pbs),origin:r.source==='world-athletics'?'World Athletics':'Swiss Athletics'};
    }));c.append(safeLink('WA-Punktetabelle 2025','https://worldathletics.org/news/news/scoring-tables-2025'));c.append(safeLink('Swiss-Athletics-Quelle','https://www.swiss-athletics.ch/'));}
    c.append(node('p','Der Chart und die besten fünf Resultate verwenden ausschliesslich abgerufene WA-Einzelresultate. Fehlende Windwerte werden nicht geschätzt.','data-note'));
    if(pbs?.length){c.append(node('h3','Abgerufene Bestleistungen · World Athletics'));table(c,['Disziplin','Leistung','Punkte','Datum','Wind'],pbs.map(pb=>pbWithWind(pb,[...live,...saResults])).map(r=>({cells:[r.discipline,resultLabel(r),r.score>0?r.score:'—',r.date,windLabel(r)]})));c.append(node('p','Die PB-Liste ist eine separate Quellenliste. Wind und Indoor werden bei eindeutigem Abgleich mit Einzelresultaten ergänzt.','data-note'));}
    root.replaceChildren(c);
  }
  const teamMeta=name=>H.team.find(a=>a.name===name)||{name};
  function teamRows(){return M.teamRanking(sources.lieteam?.data,H.team,state.teamGender,state.teamDisc);}
  async function getTeamProfile(meta,force=false){
    if(!meta.url)return null;const key=meta.url;
    if(teamPending[key])return teamPending[key];
    if(!force&&teamProfiles[key]?.status==='live')return teamProfiles[key];
    teamPending[key]=(async()=>{
      let cached;try{cached=JSON.parse(localStorage.getItem('lie_ath_'+key));}catch{}
      if(!force&&cached?.d&&Date.now()-cached.t<6*3600000){return teamProfiles[key]={data:cached.d,status:'cache',loadedAt:cached.t};}
      try{const response=await fetch('https://fiona-proxy.daniel-greuter.workers.dev?action=athlete&slug='+encodeURIComponent(key),{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('HTTP '+response.status);const data=await response.json();if(!Array.isArray(data.results))throw Error('Unbekanntes Datenformat');const t=Date.now();try{localStorage.setItem('lie_ath_'+key,JSON.stringify({t,d:data}));}catch{}return teamProfiles[key]={data,status:'live',loadedAt:t};}
      catch{return teamProfiles[key]={data:cached?.d,status:cached?'cache':'unavailable',loadedAt:cached?.t};}
    })();try{return await teamPending[key];}finally{delete teamPending[key];}
  }
  async function loadTeamProfiles(force=false){
    if(teamLoading)return;teamLoading=true;renderTeam();
    try{for(let i=0;i<H.team.length;i+=3){await Promise.allSettled(H.team.slice(i,i+3).map(a=>getTeamProfile(a,force)));renderTeam();}}finally{teamLoading=false;renderTeam();}
  }
  const countryNames={SUI:'Schweiz',LIE:'Liechtenstein',AUT:'Österreich',GER:'Deutschland',ITA:'Italien',SLO:'Slowenien',SEN:'Senegal',MON:'Monaco',FRA:'Frankreich',GIB:'Gibraltar',MKD:'Nordmazedonien',CZE:'Tschechien',SVK:'Slowakei',CRO:'Kroatien',HUN:'Ungarn',ESP:'Spanien',GBR:'Grossbritannien',PER:'Peru'};
  const teamDiscLabel=d=>({'Javelin Throw':'Speer','Discus Throw':'Diskus','Shot Put':'Kugel','High Jump':'Hochsprung','Long Jump':'Weitsprung','100m Hurdles':'100 m Hürden','60m Hurdles':'60 m Hürden'}[M.discipline(d)]||M.discipline(d));
  function teamMatch(r){
    const match=M.matchTeamPerformance(r,teamProfiles[r.meta.url]?.data);if(!match||match.venue||r.athleteName!=='Fiona Matt')return match;
    const mark=x=>String(x||'').split(/\s+/)[0].replace(',','.');const supplementary=saResults.find(s=>M.discipline(s.discipline)===M.discipline(r.name||r.discipline)&&M.dateKey(s.dateISO||s.date)===M.dateKey(match.date)&&mark(s.result)===mark(value(r)));
    return supplementary?{...match,venue:supplementary.venue,competition:supplementary.competition,wind:supplementary.wind,indoor:supplementary.indoor,venueSource:'Swiss Athletics'}:match;
  }
  async function teamResultDetail(r){
    const root=openDetail(r.athleteName+' · '+teamDiscLabel(r.name||r.discipline));root.classList.add('team-result-detail');const hero=node('div',null,'result-detail-hero');hero.append(node('h3',value(r),'team-detail-mark'));root.append(hero,node('p',r.meta.club||'','card-sub'));waBrand(root);
    const loading=node('p','Lade Wettkampfdetails …','data-note');root.append(loading);await getTeamProfile(r.meta);if(!hero.isConnected||!$('#resultDetail').open)return;loading.remove();const match=teamMatch(r),record=teamProfiles[r.meta.url];
    if(match){const context=teamContext(r);root.append(context);if(match.variantConfirmed)root.append(node('p','Gelieferte Disziplin: '+match.discipline,'data-note'));}
    table(root,['Merkmal','Wert'],[['Leistung',value(r)],['WA-Punkte',M.number(r.score)>0?r.score:'nicht geliefert'],['Datum',match?.date||'nicht geliefert'],['Lauf / Rang',M.raceLabel(match?.place)],['Wind',match?windLabel(match):'nicht geliefert'],['Wettkampf',match?.competition||'nicht geliefert'],['Ort',match?.venue||'nicht geliefert']].map(cells=>({cells})));
    root.append(node('p',match?.venueSource?'Leistung/Punkte: World Athletics · Ort/Wind: passendes Swiss-Athletics-Resultat.':record?.status==='cache'?'World Athletics · gespeicherter Profilabruf.':'World Athletics · abgerufenes Profil.','data-note'));if(!match)root.append(node('p','Kein passender Einzelresultat-Nachweis geliefert. Fehlende Angaben werden nicht ergänzt.','data-note'));
    if(r.meta.url)root.append(safeLink('World-Athletics-Profil','https://worldathletics.org/athletes/liechtenstein/'+r.meta.url));details(root,{teamResult:r,matchedResult:match||null});
  }
  function teamContext(r){
    const record=teamProfiles[r.meta.url],match=teamMatch(r);
    const context=node('div',null,'team-meet');
    if(!record){context.append(node('span','Wettkampfdetails werden beim Öffnen geladen.'));return context;}
    if(!match){context.append(node('span',record.status==='unavailable'?'Wettkampfdetails nicht erreichbar':'Kein passender Einzelresultat-Nachweis geliefert'));return context;}
    const country=match.country||match.venue?.match(/\(([A-Z]{3})\)/)?.[1]||'';
    const emblem=eventEmblem({...match,country});if(emblem)context.append(emblem);
    const info=node('div');info.append(node('span',[match.date,match.competition].filter(Boolean).join(' · ')||'Datum / Wettkampf nicht geliefert'));
    if(match.venue)info.append(node('span',(country&&country!=='SUI'?(countryNames[country]||country)+' · ':'')+match.venue));
    else info.append(node('span','Wettkampfort nicht geliefert'));
    if(record.status==='cache')info.append(node('span','Gespeicherter Profilabruf · '+new Date(record.loadedAt).toLocaleDateString('de-CH')));
    info.title=info.textContent;context.append(info);return context;
  }
  function profileBirth(meta){return teamProfiles[meta.url]?.data?.birthDate||profileMetadata[meta.url]?.birthDate||'';}
  function birthLabel(born){const iso=M.dateKey(born);return iso?iso.split('-').reverse().join('.'):/^\d{4}$/.test(born)?'Jahrgang '+born+' · genaues Datum nicht veröffentlicht':'nicht veröffentlicht';}
  function profileFacts(root,meta){const born=profileBirth(meta),year=Number(today().slice(0,4));const facts=node('div',null,'team-profile-facts');facts.append(node('span','Geboren: '+birthLabel(born)),node('span','Verein: '+(meta.club||'nicht geliefert')),node('span','Alterskategorie '+year+': '+M.ageCategory(born,year)));root.append(facts);}
  async function athleteDetail(name,disc='100m'){
    const meta=teamMeta(name),root=openDetail(name+' · Athletenprofil');root.classList.add('team-result-detail');waBrand(root);profileFacts(root,meta);
    const progress=node('p','Lade alle Bestleistungen …','data-note');root.append(progress);const record=await getTeamProfile(meta);if(!progress.isConnected||!$('#resultDetail').open)return;const individual=record?.data;
    progress.textContent=record?.status==='live'?'World Athletics · abgerufenes Profil':record?.status==='cache'?'World Athletics · gespeicherter Profilabruf':'Profil momentan nicht erreichbar.';
    const pbs=individual?.pbs||individual?.personalBests||[];
    root.append(node('h3','Alle Bestleistungen · '+pbs.length+' Disziplinen'));
    if(pbs.length){table(root,['Disziplin','Bestleistung / Datum'],pbs.map(r=>{const cell=node('div');cell.append(node('strong',value(r)),node('span',r.date||'Datum nicht geliefert','pb-date'));const matched=(individual.results||[]).find(x=>x.discipline===r.discipline&&M.dateKey(x.date)===M.dateKey(r.date)&&value(x).split(' ')[0]===value(r).split(' ')[0]);if(matched?.wind)cell.append(node('span','Wind: '+windLabel(matched),'pb-date'));if(M.number(r.score)>0)cell.append(node('span',r.score+' WA-Punkte','pb-date'));if(r.records?.length)cell.append(node('span',r.records.join(' · '),'pb-date'));const label=teamDiscLabel(r.discipline).replace(/^Javelin Throw/,'Speer').replace(/^Discus Throw/,'Diskus').replace(/^Shot Put/,'Kugel').replace(/^High Jump/,'Hochsprung').replace(/^Long Jump/,'Weitsprung').replace(/Hurdles/,'Hürden')+(/Short Track|Indoor/i.test(r.discipline)?' · Halle':'');return {cells:[label,cell]};}));}
    else root.append(node('p','Keine Bestleistungsübersicht geliefert.'));
    root.append(node('p','Alle vom WA-Profil gelieferten Disziplinen, inklusive Halle, früherer Altersklassen, Hürdenhöhen und Wurfgewichte. Die Quelle kann unvollständig sein. Alterskategorie nach Jahrgang, nicht nach dem heutigen Geburtstag.','data-note'));
    if(individual?.results){const field=/Jump|Throw|Put/.test(disc),rows=individual.results.filter(r=>M.discipline(r.discipline)===disc).sort((a,b)=>{const av=M.number(value(a)),bv=M.number(value(b));return field?bv-av:av-bv;}).slice(0,5);const recent=node('details');recent.append(node('summary','Top 5 · '+teamDiscLabel(disc)+' · nach Leistung'));table(recent,['Datum','Resultat','Wind','Ort'],rows.map(r=>({cells:[r.date,value(r),windLabel(r),r.venue||r.competition||'nicht geliefert']})));root.append(recent);}
    if(meta.url)root.append(safeLink('World-Athletics-Profil','https://worldathletics.org/athletes/liechtenstein/'+meta.url));if(profileMetadata[meta.url])root.append(node('p','Geburtsangabe: WA-Profil · geprüft '+profileMetadata[meta.url].checkedAt,'data-note'));if(individual)details(root,individual);
  }
  function renderTeam(){
    if(!window.document)return;
    const root=$('#teamContent'),c=card('Team LIE · Leistungsranking','Pro Athlet:in die zwei Disziplinen mit den höchsten gelieferten WA-Punkten. Alle Leistungen werden gemeinsam nach Punkten rangiert.');waBrand(c);
    const controls=node('div',null,'filters');controls.append(select('Disziplin',[['Alle','Alle · Top 2 pro Athlet:in'],...new Set([...discs.map(d=>d[0]),...Object.values(sources.lieteam?.data||{}).flatMap(a=>(a.discs||[]).map(d=>M.discipline(d.name||d.discipline)))])],state.teamDisc,v=>{state.teamDisc=v;renderTeam();}),select('Kategorie',[['Alle','Alle'],['f','Frauen'],['m','Männer']],state.teamGender,v=>{state.teamGender=v;renderTeam();}));c.append(controls);status(c,'lieteam');c.append(button(teamLoading?'Wettkampfdetails werden geladen …':'Wettkampfdetails aktualisieren',()=>loadTeamProfiles(true)));
    const rows=teamRows(),max=Math.max(1,...rows.map(r=>M.number(r.score)||0));
    for(const r of rows){
      const box=node('article',null,'team-ranking-row'+(r.athleteName==='Fiona Matt'?' fiona-row':''));box.append(node('span',r.rank||'—','team-rank'));
      const info=node('div',null,'team-ranking-info');info.append(button(r.athleteName,()=>athleteDetail(r.athleteName,M.discipline(r.name||r.discipline)),'athlete-link'),node('span',r.meta.club||'','card-sub'));
      const performance=node('div',null,'team-ranking-performance');performance.append(button(teamDiscLabel(r.name||r.discipline)+(/Short Track|Indoor/i.test(r.name||r.discipline||'')?' (Halle)':'')+' · '+value(r)+' ↗',()=>teamResultDetail(r),'team-result-button'),teamContext(r));info.append(performance);
      const points=node('strong',M.number(r.score)>0?r.score+' Punkte':'keine Punkte','team-points');box.append(info,points);
      const bar=node('div',null,'comparison-track'),fill=node('span');fill.style.width=Math.max(0,(M.number(r.score)||0)/max*100)+'%';bar.append(fill);box.append(bar);c.append(box);
    }
    if(!rows.length)c.append(node('p','Keine Teamdaten für diesen Filter verfügbar.'));
    c.append(node('p','Gleiche Punktzahl = gleicher Rang. Ohne Punkte wird kein Rang vergeben. Werden weniger als zwei Disziplinen geliefert, zeigen wir nur die vorhandenen. WA-Leistungspunkte vergleichen einzelne Leistungen, nicht das offizielle World Ranking.','data-note'));
    const roster=node('details',null,'team-roster');roster.open=rosterOpen;roster.ontoggle=()=>{if(roster.isConnected)rosterOpen=roster.open;};roster.append(node('summary','Athlet:innen & Profile'));for(const a of H.team){const line=node('article',null,'team-profile-card'+(a.isMe?' fiona-row':''));line.append(button(a.name,()=>athleteDetail(a.name),'athlete-link'));profileFacts(line,a);const pbs=teamProfiles[a.url]?.data?.pbs;line.append(button('Alle Bestleistungen'+(pbs?' · '+pbs.length+' Disziplinen':'')+' ↗',()=>athleteDetail(a.name),'team-profile-open'));roster.append(line);}c.append(roster);root.replaceChildren(c);
  }
  function eventEmblem(e){
    const cantons='ZH BE LU UR SZ OW NW GL ZG FR SO BS BL SH AR AI SG GR AG TG TI VD VS NE GE JU'.split(' ');
    let code=String(e.canton||'').trim().toUpperCase();
    const location=[e.venue,e.venueCity,e.location].filter(x=>typeof x==='string').join(' ');
    // Calendar entries can carry the venue only in the event title.
    const loc=(location||[e.name,e.title,e.summary].filter(x=>typeof x==='string').join(' ')).toLowerCase();
    if(!cantons.includes(code))code='';
    if(!code){for(const [city,canton]of [['zürich','ZH'],['zurich','ZH'],['lausanne','VD'],['luzern','LU'],['aarau','AG'],['meilen','ZH'],['cham','ZG'],['schaffhausen','SH'],['macolin','BE'],['biel','BE'],['bienne','BE'],['basel','BS'],['thun','BE'],['magglingen','BE'],['langenthal','BE'],['bellinzona','TI'],['freiburg','FR'],['fribourg','FR'],['freienbach','SZ'],['frauenfeld','TG'],['st. gallen','SG'],['winterthur','ZH'],['wetzikon','ZH'],['regensdorf','ZH'],['kreuzlingen','TG'],['bulle','FR'],['zug','ZG'],['zofingen','AG'],['uster','ZH'],['düdingen','FR'],['delémont','JU'],['rapperswil','SG'],['arbon','TG']])if((' '+loc.replace(/[^a-zäöüéèà]+/gi,' ')+' ').includes(' '+city.replace(/[^a-zäöüéèà]+/gi,' ')+' ')){code=canton;break;}}
    let src='',alt='';if(cantons.includes(code)){const local={BE:'bern',VD:'vaud',SG:'st-gallen',ZH:'zurich',ZG:'zug',TG:'thurgau',TI:'ticino',FR:'fribourg'};src=local[code]?'./assets/'+local[code]+'-coat.svg':'https://fiona-proxy.daniel-greuter.workers.dev?action=wappen&v=3&c='+code;alt='Kantonswappen '+code;}
    else {const cityCountry=[['skopje','MKD'],['rieti','ITA'],['dornbirn','AUT'],['lima','PER']].find(([city])=>loc.includes(city))?.[1];const country=String(e.country||cityCountry||[e.venue,e.venueCity,e.location].filter(x=>typeof x==='string').join(' ').match(/\(([A-Z]{3})\)/)?.[1]||'').toUpperCase();if(['LIE','LI'].includes(country)||/schaan|vaduz|mauren|liechtenstein/.test(loc)){src='./assets/liechtenstein-flag.webp';alt='Liechtenstein';}else if(country==='SEN'||loc.includes('dakar')){src='./assets/senegal-flag.svg';alt='Senegal';}else {const local={AUT:'austria',SLO:'slovenia',PER:'peru',ITA:'italy',MKD:'north-macedonia'};if(local[country]){src='./assets/'+local[country]+'-flag.svg';alt='Flagge '+(countryNames[country]||country);}else {const iso={GER:'de',FRA:'fr',MON:'mc',GIB:'gi',CZE:'cz',SVK:'sk',CRO:'hr',HUN:'hu',ESP:'es',GBR:'gb',SUI:'ch'}[country];if(iso){src='https://flagcdn.com/'+iso+'.svg';alt='Flagge '+(countryNames[country]||country);}}}}
    if(!src)return null;const img=node('img',null,'event-emblem');img.src=src;img.alt=alt;img.width=28;img.height=32;img.loading='lazy';img.onerror=()=>{img.hidden=true;};return img;
  }
  function eventRow(parent,e,editable=false,collapseComment=false,compact=false){
    const box=node('article',null,'calendar-event'+(compact?' calendar-event-compact':''));const heading=node('div',null,'event-heading');const emblem=eventEmblem(e);if(emblem)heading.append(emblem);const title=node('div');title.append(node('div',dateLabel(e),'event-date'),node('h3',e.name||e.title||e.summary||'Termin'));heading.append(title);box.append(heading);const location=e.venue||(typeof e.location==='string'?e.location:'');if(location||compact&&e.stadium)box.append(node('p',compact?[location,e.stadium].filter(Boolean).join(' · '):location,'event-location'));
    const comment=e.comment||e.description||e.details||e.note;if(comment&&!compact){const content=node('p',comment,'event-comment');if(collapseComment){const disclosure=node('div',null,'training-details'),key=String(e.id||'')+'|'+dateLabel(e)+'|'+(e.name||e.title||e.summary||'');const toggle=button('Trainingsdetails anzeigen',()=>{const open=content.hidden;content.hidden=!open;toggle.setAttribute('aria-expanded',String(open));toggle.textContent=open?'Trainingsdetails zuklappen':'Trainingsdetails anzeigen';if(open)openTrainingDetails.add(key);else openTrainingDetails.delete(key);},'training-details-toggle');const open=openTrainingDetails.has(key);content.hidden=!open;toggle.setAttribute('aria-expanded',String(open));if(open)toggle.textContent='Trainingsdetails zuklappen';disclosure.append(toggle,content);box.append(disclosure);}else box.append(content);}
    if(M.isCompetition(e)){
      const statusText=[eventName(e),e.registrationStatus,e.status,e.comment].filter(x=>typeof x==='string').join(' ');
      const notRegistered=/nicht\s+angemeldet/i.test(statusText)||e.fionaStarting===false;
      if(notRegistered)box.append(node('p','✕ Nicht angemeldet','registration-status not-registered'));
      else if(e.fionaStarting)box.append(node('p','✓ Fiona startet','registration-status registered'));
      if(e.stadium&&!compact)box.append(node('p','Wettkampfstätte: '+e.stadium,'event-stadium'));
      if(e.organizer&&!compact)box.append(node('p','Veranstalter: '+e.organizer,'data-note'));
      box.append(node('p',e.deadline?'Anmeldefrist: '+e.deadline+(e.deadlineSource?' · '+e.deadlineSource:''):'Anmeldefrist: noch nicht veröffentlicht','data-note'));
      if(e.deadline&&M.dateKey(e.deadline)&&M.dateKey(e.deadline)<today())box.append(node('span','Meldeschluss vorbei','badge'));
      if(e.detailsUrl)box.append(safeLink('Ausschreibung / Quelle ↗',e.detailsUrl));
    }
    const disciplines=Array.isArray(e.disciplines)?e.disciplines:[e.disciplines].filter(Boolean);
    const tags=[...(M.isCompetition(e)?disciplines:[]),e.time||e.startTime||''].filter(Boolean);if(tags.length)box.append(node('p',tags.join(' · '),'data-note'));
    const actions=node('div',null,'tabs');actions.append(button('Details',()=>{const root=openDetail(e.name||e.title||'Termin');eventRow(root,e,false);details(root,e);}));if(editable&&e.id!=null)actions.append(button('Bearbeiten',()=>eventEditor(e)),button('Löschen',()=>deleteEvent(e)));box.append(actions);if(collapseComment){box.classList.add('training-event-clickable');box.tabIndex=0;box.setAttribute('aria-label',(e.name||e.title||e.summary||'Training')+' · Details öffnen');const activate=()=>{const toggle=box.querySelector('.training-details-toggle');if(toggle)toggle.click();else actions.querySelector('button').click();};box.addEventListener('click',event=>{if(event.target.closest('button,a,input,select,textarea'))return;activate();});box.addEventListener('keydown',event=>{if(event.target===box&&(event.key==='Enter'||event.key===' ')){event.preventDefault();activate();}});}parent.append(box);
  }
  const calendarUrl='https://www.swiss-athletics.ch/wettkaempfe/veranstaltungen/wettkampfkalender/';
  const eventName=e=>String(e.name||e.title||e.summary||'');
  const eventWords=text=>String(text||'').toLocaleLowerCase('de').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\b(?:wk|wrc|wact)\b/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  function calendarEnrich(e){
    const day=M.dateKey(e.date||e.start);
    const candidates=(sources.chcalendar?.data?.events||[]).filter(x=>M.dateKey(x.date||x.start)===day&&(e.sourceId&&x.sourceId===e.sourceId||eventWords(eventName(x))===eventWords(eventName(e))));
    if(candidates.length!==1)return e;
    const match=candidates[0];
    const venue=e.venue||(typeof e.location==='string'?e.location:'');
    if(venue&&match.venue&&eventWords(venue)!==eventWords(match.venue))return e;
    return {...match,...e,venue:venue||match.venue,stadium:e.stadium||match.stadium,organizer:e.organizer||match.organizer,deadline:e.deadline||match.deadline,deadlineSource:!e.deadline&&match.deadline?'Swiss Athletics':e.deadlineSource,detailsUrl:e.detailsUrl||match.detailsUrl};
  }
  function sprintInfo(e){
    const program=Array.isArray(e.disciplines)?e.disciplines.join(' '):String(e.disciplines||'');
    const text=program||eventName(e);
    const matches=[...text.matchAll(/(?:^|[^0-9x])((?:50|55|60|75|80|100|150|200|300|400))\s*m(?![a-z]|\s*(?:H|Hürden))/gi)].map(m=>m[1]+'m');
    const disciplines=[...new Set(matches)];
    const fieldOnly=/stab|perche|javelin|wurf|werfer|sprung|techniker|mehrkampf|cross|marathon|strasse/i.test(text)&&!disciplines.length&&!/sprint/i.test(text);
    if(fieldOnly||program&&!disciplines.length)return null;
    const possible=/meeting|meisterschaft|championnat|sprint|courses|gala|sm\b|national/i.test(eventName(e));
    return disciplines.length?{disciplines,confirmed:!!program}:possible?{disciplines:[],confirmed:false}:null;
  }
  function renderSprintCalendar(parent){
    const disclosure=node('details',null,'sprint-calendar');disclosure.open=state.sprintOpen;
    disclosure.ontoggle=()=>{if(disclosure.isConnected)state.sprintOpen=disclosure.open;};
    disclosure.append(node('summary','Alle verfügbaren Wettkämpfe Sprint'));
    const body=node('div',null,'sprint-calendar-body');disclosure.append(body);
    body.append(node('p','Swiss Athletics · 60 / 100 / 150 / 200 m und weitere Sprintstrecken. Ausschreibungen und Kategorien vor der Anmeldung prüfen.','data-note'));
    body.append(safeLink('Swiss-Athletics-Wettkampfkalender ↗',calendarUrl));status(body,'chcalendar');
    const controls=node('div',null,'filters');
    controls.append(select('Sprintstrecke',['Alle','60m','100m','150m','200m','Weitere'],state.sprintDiscipline,v=>{state.sprintDiscipline=v;state.sprintOpen=true;renderCalendar();}));
    const search=node('input',null,'select');search.type='search';search.placeholder='Ort, Stadion oder Wettkampf';search.setAttribute('aria-label','Sprint-Wettkämpfe suchen');search.value=state.sprintSearch;search.onchange=()=>{state.sprintSearch=search.value;state.sprintOpen=true;renderCalendar();};controls.append(search);body.append(controls);
    const events=(sources.chcalendar?.data?.events||[]).map(e=>({e,info:sprintInfo(e)})).filter(({e,info})=>{
      if(!info)return false;const d=M.dateKey(e.date||e.start);
      if(state.calendarPeriod!=='Alle'&&(!d||(state.calendarPeriod==='Kommende'?d<today():d>=today())))return false;
      if(state.sprintDiscipline!=='Alle'&&(state.sprintDiscipline==='Weitere'?!info.disciplines.some(x=>!['60m','100m','150m','200m'].includes(x)):!info.disciplines.includes(state.sprintDiscipline)))return false;
      return JSON.stringify(e).toLocaleLowerCase('de').includes(state.sprintSearch.toLocaleLowerCase('de'));
    }).sort((a,b)=>M.dateKey(a.e.date).localeCompare(M.dateKey(b.e.date)));
    body.append(node('p',events.length+' verfügbare Einträge im geladenen Quellenstand · Zeitraum: '+state.calendarPeriod,'data-note'));
    for(const {e,info}of events){
      const item=node('details',null,'sprint-event');const summary=node('summary');
      const emblem=eventEmblem(e);if(emblem)summary.append(emblem);
      const label=node('div');label.append(node('span',dateLabel(e),'event-date'),node('strong',eventName(e)),node('span',[e.venue,e.stadium].filter(Boolean).join(' · ')||'Wettkampfstätte noch nicht veröffentlicht','sprint-venue'));summary.append(label);
      const badges=node('div',null,'sprint-badges');badges.append(node('span',info.disciplines.join(' · ')||'Sprintangebot offen','badge info'));if(!info.confirmed)badges.append(node('span','Programm prüfen','badge'));
      if(e.deadline)badges.append(node('span','Meldeschluss '+e.deadline,'badge'));summary.append(badges);item.append(summary);
      const content=node('div',null,'sprint-event-body');eventRow(content,{...e,isWettkampf:true},false);item.append(content);body.append(item);
    }
    if(!events.length)body.append(node('p','Keine passenden Einträge im geladenen Quellenstand. Der vollständige Kalender ist oben verlinkt.','data-note'));
    parent.append(disclosure);
  }
  function renderCalendar(){
    const root=$('#calendarContent'),c=card('Wettkämpfe','Fionas Wettkampfplanung · Termine, Anmeldung und Wettkampfstätten.');const controls=node('div',null,'filters');controls.append(select('Quelle',['Fiona','Schweiz'],state.calendarSource,v=>{state.calendarSource=v;renderCalendar();}),select('Zeitraum',['Kommende','Alle','Vergangene'],state.calendarPeriod,v=>{state.calendarPeriod=v;renderCalendar();}));
    const search=node('input',null,'select');search.type='search';search.placeholder='Ort oder Wettkampf suchen';search.setAttribute('aria-label','Ort oder Wettkampf suchen');search.value=state.calendarSearch;search.onchange=()=>{state.calendarSearch=search.value;renderCalendar();};controls.append(search,button('Wettkampf hinzufügen',()=>eventEditor()));c.append(controls);
    const action=state.calendarSource==='Fiona'?'calendar':'chcalendar';status(c,action);
    let events=state.calendarSource==='Fiona'?(sources.calendar?.data||H.athlete.upcoming||[]):(sources.chcalendar?.data?.events||[]);
    if(state.calendarSource==='Fiona'&&sources.calendar?.data)events=events.filter(M.isCompetition);
    if(state.calendarSource==='Fiona'&&!sources.calendar?.data)c.append(node('p','Historischer V1-Kalender · Termine und Teilnahmestatus können überholt sein.','data-note'));
    events=events.filter(e=>{const d=M.dateKey(e.date||e.start);return state.calendarPeriod==='Alle'||d&&(state.calendarPeriod==='Kommende'?d>=today():d<today());}).filter(e=>JSON.stringify(e).toLocaleLowerCase('de').includes(state.calendarSearch.toLocaleLowerCase('de'))).slice().sort((a,b)=>M.dateKey(a.date||a.start).localeCompare(M.dateKey(b.date||b.start)));
    const future=events.filter(e=>M.dateKey(e.date||e.start)>=today());c.append(node('p',events.length+' Wettkämpfe in dieser Ansicht · '+future.length+' kommende.','data-note'));
    const liveEditable=state.calendarSource==='Fiona'&&sources.calendar?.status==='live';for(const e of events)eventRow(c,state.calendarSource==='Fiona'?calendarEnrich(e):{...e,isWettkampf:true},liveEditable,false,true);if(!events.length)c.append(node('p','Keine Wettkämpfe für diesen Filter.'));
    renderSprintCalendar(c);root.replaceChildren(c);
  }
  async function mutation(action,body){
    const response=await fetch('https://fiona-proxy.daniel-greuter.workers.dev?action='+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('HTTP '+response.status);const result=await response.json();if(!result.ok)throw Error(result.error||'Speichern fehlgeschlagen');
    // Reload only after confirmed save. Failed writes never alter displayed source data.
    await refreshCalendar();return result;
  }
  function eventEditor(event){
    const root=openDetail(event?'Wettkampf bearbeiten':'Wettkampf hinzufügen');const form=node('form',null,'event-form');const fields={};
    for(const [key,label,type,initial]of [['date','Datum','date',M.dateKey(event?.date)],['name','Wettkampf','text',event?.name],['venue','Ort','text',event?.venue],['disciplines','Disziplinen, durch Komma getrennt','text',(event?.disciplines||[]).join(', ')],['deadline','Meldeschluss','text',event?.deadline]]){const l=node('label',null,'control');l.append(node('span',label));const input=node('input',null,'select');input.type=type;input.value=initial||'';input.required=key==='date'||key==='name';fields[key]=input;l.append(input);form.append(l);}
    const check=node('input');check.type='checkbox';check.checked=!!event?.fionaStarting;const label=node('label','Fiona startet ');label.append(check);form.append(label);const status=node('p',null,'data-note');const submit=node('button','Speichern','tab');submit.type='submit';form.append(submit,status);root.append(form);
    form.onsubmit=async e=>{e.preventDefault();const iso=fields.date.value;if(!M.dateKey(iso)||!fields.name.value.trim()){status.textContent='Gültiges Datum und Wettkampfname sind erforderlich.';return;}const parts=iso.split('-');const body={date:parts.reverse().join('.'),name:fields.name.value.trim(),venue:fields.venue.value.trim(),disciplines:fields.disciplines.value.split(',').map(s=>s.trim()).filter(Boolean),deadline:fields.deadline.value.trim(),fionaStarting:check.checked};if(event)body.id=event.id;submit.disabled=true;status.textContent='Speichere …';try{await mutation(event?'calendar-update':'calendar-add',body);status.textContent='Gespeichert.';$('#resultDetail').close();}catch(error){status.textContent='Nicht gespeichert: '+error.message;submit.disabled=false;}};
  }
  function deleteEvent(event){const root=openDetail('Wettkampf löschen?');root.append(node('p',event.name+' · '+event.date));const status=node('p',null,'data-note');const confirm=button('Diesen Wettkampf löschen',async()=>{confirm.disabled=true;try{await mutation('calendar-delete',{id:event.id});$('#resultDetail').close();}catch(error){status.textContent='Nicht gelöscht: '+error.message;confirm.disabled=false;}});root.append(confirm,status);}
  function renderTraining(){
    const root=$('#liveTraining');root.replaceChildren();status(root,'calendar');
    const controls=node('div',null,'tabs');controls.append(button('← Vorige Woche',()=>{state.weekOffset--;renderTraining();}),button('Diese Woche',()=>{state.weekOffset=0;renderTraining();}),button('Nächste Woche →',()=>{state.weekOffset++;renderTraining();}));root.append(controls);
    const now=new Date(today()+'T12:00:00Z');const day=(now.getUTCDay()+6)%7;now.setUTCDate(now.getUTCDate()-day+state.weekOffset*7);const start=now.toISOString().slice(0,10);now.setUTCDate(now.getUTCDate()+6);const end=now.toISOString().slice(0,10);root.append(node('h3',start+' — '+end));
    const events=M.trainingEvents(sources.calendar?.data||[]).filter(e=>{const d=M.dateKey(e.date||e.start);return d>=start&&d<=end;});
    for(const e of events){const text=(e.name+' '+(e.comment||e.description||'')).toLowerCase();const type=/wicket/.test(text)?'Wickets':/max.?v|velocity|max.?speed/.test(text)?'Max Velocity':/accel|beschleunig|block/.test(text)?'Acceleration':/speed endurance|schnelligkeitsausdauer/.test(text)?'Speed Endurance':/kraft|gym|strength/.test(text)?'Kraft':/recovery|erholung|pause/.test(text)?'Recovery':'Training';const badge=node('p',type+' · aus Kalendertext erkannt','badge info');root.append(badge);eventRow(root,e,false,true);}
    if(!events.length)root.append(node('p','Keine Kalendereinträge für diese Woche verfügbar. Die Grundstruktur steht darunter.'));
  }

  async function refreshCalendar(){
    if(calendarRefresh)return calendarRefresh;
    calendarRefresh=window.FionaSources.loadOne('calendar',{force:true});
    renderTraining();renderCalendar();
    try{return await calendarRefresh;}finally{calendarRefresh=null;renderTraining();renderCalendar();}
  }
  const calendarVisible=()=>['training','calendar'].some(view=>$('#view-'+view).classList.contains('active'));
  const calendarStale=()=>!sources.calendar || sources.calendar.status!=='live' || Date.now()-Date.parse(sources.calendar.loadedAt)>60000;
  window.addEventListener('fiona-view',event=>{
    if(event.detail.view==='team')loadTeamProfiles();
    if(['training','calendar'].includes(event.detail.view))refreshCalendar();
  });
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&calendarVisible()&&calendarStale())refreshCalendar();});
  window.addEventListener('pageshow',event=>{if(event.persisted&&calendarVisible())refreshCalendar();});
  window.addEventListener('online',()=>{if(calendarVisible())refreshCalendar();});
  setInterval(()=>{if(document.visibilityState==='visible'&&calendarVisible())refreshCalendar();},300000);
  window.addEventListener('fiona-results',event=>{saResults=event.detail.results||[];renderWA();renderTeam();});
  window.addEventListener('fiona-source',event=>{sources[event.detail.action]=event.detail;renderRankings();renderWA();renderTeam();renderCalendar();renderTraining();});
  renderRankings();renderWA();renderTeam();renderCalendar();renderTraining();
  if($('#view-team').classList.contains('active'))loadTeamProfiles();
  fetch('./team-profile-metadata.json').then(r=>r.ok?r.json():{}).then(data=>{profileMetadata=data||{};renderTeam();}).catch(()=>{});
  window.FionaMigrationUI={openAthleteProfile:athleteDetail,state,sources,eventEmblem,renderRankings,renderWA,renderTeam,renderCalendar,renderTraining};
})();
