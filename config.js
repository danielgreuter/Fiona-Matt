
window.FIONA_APP_CONFIG = {
  athlete: {
    name: "Fiona Matt",
    country: "Liechtenstein",
    countryCode: "LI",
    club: "TV Eschen-Mauren",
    birthDate: "2009-09-02",
    licenseNumber: "251392",
    coach: "Christian Gutgsell",
    focus: "100 m"
  },
  gallery: { apiBase: "https://fiona-gallery.daniel-greuter.workers.dev" },
  target: {
    title: "Youth Olympic Games Dakar 2026",
    shortTitle: "Dakar 2026",
    event: "100 m",
    date: "2026-11-08T00:00:00+00:00",
    location: "Dakar, Senegal"
  },
  dakarStory: { reflection: "", videoUrl: "", cardPhoto: "./assets/fiona-portrait.jpg" },
  dakarResults: [
      {result:'12.15',place:'3sf1',fionaRank:3,wind:-1.1,windAssisted:false,top5:[{"rank":1,"name":"Dana SALEM","club":"QAT","result":"11.75","wind":-1.1},{"rank":2,"name":"Ieva MALNAČA","club":"LAT","result":"11.99","wind":-1.1},{"rank":3,"name":"Fiona MATT","club":"LIE","result":"12.15","wind":-1.1},{"rank":4,"name":"Khylinn PRENTICE","club":"SKN","result":"12.41","wind":-1.1},{"rank":5,"name":"Astghik PANOSYAN","club":"ARM","result":"12.83","wind":-1.1}]},
      {result:'11.93',place:'6f',fionaRank:6,wind:2.4,windAssisted:true,top5:[{"rank":1,"name":"Rosemary NWANKWO","club":"NGR","result":"11.16","wind":2.4},{"rank":2,"name":"Arwa ALI","club":"UAE","result":"11.41","wind":2.4},{"rank":3,"name":"Dana SALEM","club":"QAT","result":"11.48","wind":2.4},{"rank":4,"name":"Alma Børregaard RAVN","club":"DEN","result":"11.75","wind":2.4},{"rank":5,"name":"Ieva MALNAČA","club":"LAT","result":"11.82","wind":2.4}]}
    ],
  milestones: [
    {date:"2024-08-31", title:"Schweizer Meisterin U16", detail:"80 m · 9.97 s · Lausanne", emblem:"./assets/vaud-coat.svg", emblemAlt:"Kantonswappen Waadt"},
    {date:"2024-09-22", title:"Silber UBS Kids Cup- und Visana Sprint-Finale - W15", detail:"Visana Sprint: Gesamtzweite · 80 m in 9.99 s · Bern, Bundesplatz.\n07.09.2024 · UBS Kids Cup: Gesamtzweite · 2’426 Punkte · Zürich, Letzigrund.", emblem:"./assets/switzerland-flag.svg", emblemAlt:"Flagge Schweiz", source:"https://www.ostschweiz-athletics.ch/post/schweizerfinals-2024"},
    {date:"2025-06-21", title:"Erster U20-Landesrekord", detail:"100 m · 12.24 s · Bellinzona · Regionenmeisterschaften Ostschweiz · Finale, Rang 2 · Wind +1.4 m/s", emblem:"./assets/ticino-coat.svg", emblemAlt:"Kantonswappen Tessin", source:"https://www.swiss-athletics.ch/fileadmin/user_upload/www.swiss-athletics.ch/wettkaempfe/Veranstaltungen/Meisterschaften_SVM/Ranglisten_SM/Resultate_RMOst_2025.pdf"},
    {date:"2025-07-21", title:"EYOF Skopje", detail:"100 m · internationale Bühne", emblem:"./assets/north-macedonia-flag.svg", emblemAlt:"Flagge Nordmazedonien"},
    {date:"2026-02-21", title:"SM Halle Nachwuchs", detail:"60 m · 7.60 s · Bronze", emblem:"./assets/bern-coat.svg", emblemAlt:"Kantonswappen Bern"},
    {date:"2026-07-01", title:"U23-Landesrekord", detail:"100 m · 11.91 s · Fribourg International Meeting / EM-Trials · Vorlauf, Rang 2 · Wind +1.7 m/s", emblem:"./assets/fribourg-coat.svg", emblemAlt:"Kantonswappen Freiburg", source:"https://athletics.li/records-women-u23/"},
    {date:"2026-07-16", title:"U18-EM Rieti · qualifiziert", detail:"100 m · internationale Limite erreicht", status:"verletzt", emblem:"./assets/italy-flag.svg", emblemAlt:"Flagge Italien"},
    {date:"2026-11-08", title:"6. Platz an den Youth Olympic Games", detail:"100 m · Dakar · Halbfinale: 3. Platz in 12.15 s (−1.1 m/s) · Finale: 11.93 s (+2.4 m/s)", source:"https://worldathletics.org/results/youth-olympic-games/2026/youth-olympic-games-7147638/women/100-metres/final/result", emblem:"./assets/senegal-flag.svg", emblemAlt:"Flagge Senegal"}
  ],
  trainingWeek: [
    {day:"Mo", title:"17:00 Uhr · Athletikzentrum, St. Gallen", detail:"Leitung: Gutsi", type:"Track", country:"Schweiz", flag:"./assets/switzerland-flag.svg"},
    {day:"Di", title:"15:00 Uhr · Leichtathletikhalle Dornbirn", detail:"Leitung: Gutsi", type:"Track", country:"Österreich", flag:"./assets/austria-flag.svg"},
    {day:"Mi", title:"07:45 Uhr · Olympiazentrum Dornbirn", detail:"Jule & Theresa", type:"Kraft", country:"Österreich", flag:"./assets/austria-flag.svg"},
    {day:"Mi", title:"16:00 Uhr · Athletikzentrum, St. Gallen", detail:"Selbständig · AZSG-Slot unserer Gruppe · Nutzung je nach Programm", type:"Optional", country:"Schweiz", flag:"./assets/switzerland-flag.svg"},
    {day:"Do", title:"18:00 Uhr · Athletikzentrum, St. Gallen", detail:"Leitung: Yves / Gian-Luca", type:"Track", country:"Schweiz", flag:"./assets/switzerland-flag.svg"},
    {day:"Fr", title:"13:30 Uhr · Olympiazentrum Dornbirn", detail:"Jule & Theresa", type:"Kraft", country:"Österreich", flag:"./assets/austria-flag.svg"},
    {day:"Sa", title:"13:00 Uhr · Balgach / Athletikzentrum, St. Gallen", detail:"Leitung: Gutsi · Anfangs und bei guter Witterung vorläufig in Balgach", type:"Track", country:"Schweiz", flag:"./assets/switzerland-flag.svg"},
    {day:"So", title:"09:30 Uhr · Athletikzentrum, St. Gallen", detail:"Gelegentlich · Ausweichtermin, insbesondere wenn das AZSG am Samstag belegt ist oder ein Wechsel gewünscht ist", type:"Optional", country:"Schweiz", flag:"./assets/switzerland-flag.svg"}
  ]
};
