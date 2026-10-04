(() => {
  const splash=document.querySelector('#splash-screen');
  let closeTimer,hideTimer;
  const dismiss=()=>{
    clearTimeout(closeTimer);clearTimeout(hideTimer);
    splash.classList.add('exiting');
    hideTimer=setTimeout(()=>{splash.hidden=true;},220);
  };
  const intro=()=>{
    clearTimeout(closeTimer);clearTimeout(hideTimer);
    splash.hidden=false;splash.classList.remove('exiting');
    const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    closeTimer=setTimeout(dismiss,reduced?400:1600);
  };
  document.querySelector('#skipIntro').onclick=dismiss;
  document.querySelector('#replayIntro').onclick=intro;
  document.querySelector('#openPortrait').onclick=()=>{
    const dialog=document.querySelector('#resultDetail'),body=document.querySelector('#detailContent');
    const title=document.createElement('h2');title.textContent='Fiona Matt';
    const img=document.createElement('img');img.src='./assets/fiona-portrait.jpg';img.alt='Fionas Originalfoto mit ihrer Goldmedaille';img.className='portrait-zoom';
    body.replaceChildren(title,img);document.querySelector('#closeDetail').onclick=()=>dialog.close();dialog.showModal();
  };
  const dialog=document.querySelector('#resultDetail');
  document.querySelector('#closeDetail').onclick=()=>dialog.close();
  let outsideDown=false;
  const outside=e=>{const rect=dialog.getBoundingClientRect();return e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom;};
  dialog.addEventListener('pointerdown',e=>{outsideDown=e.target===dialog&&outside(e);});
  dialog.addEventListener('click',e=>{if(e.target===dialog&&outsideDown&&outside(e))dialog.close();outsideDown=false;});
  dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();dialog.close();}});
  document.querySelector('#openMedalMoment').onclick=()=>document.querySelector('#openPortrait').click();
  const banner=document.querySelector('.athlete-banner'),topbar=document.querySelector('.topbar');
  if(window.IntersectionObserver){const observer=new IntersectionObserver(entries=>{topbar.classList.toggle('is-compact',!entries[0].isIntersecting&&banner.getBoundingClientRect().bottom<0);},{threshold:0});observer.observe(banner);}
  const updateRoad=()=>{
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Vaduz',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const index=day<'2026-11-04'?1:day<'2026-11-08'?2:3,steps=[...document.querySelectorAll('[data-road]')];
    steps.forEach((step,i)=>{step.classList.toggle('is-complete',i<index);step.classList.toggle('is-current',i===index);if(i===index)step.setAttribute('aria-current','step');else step.removeAttribute('aria-current');});
    document.querySelector('#roadStatus').textContent=day>'2026-11-08'?'Wettkampftermin: 08. November 2026':index===1?'Jetzt: Vorbereitung · nächste Station: Teamreise am 04. November':index===2?'Teamreise ab 04. November · Wettkampf am 08. November':'Heute: 100 m in Dakar';
  };
  const updateProfile=()=>{
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Vaduz',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),born=window.FIONA_APP_CONFIG.athlete.birthDate,year=Number(date.slice(0,4));
    const age=year-Number(born.slice(0,4))-(date.slice(5)<born.slice(5)?1:0);
    document.querySelector('#fionaProfileAge').textContent=age+' Jahre';
    document.querySelector('#fionaProfileCategory').textContent=window.FionaModels.ageCategory(born,year)+' · Saison '+year;
  };
  document.querySelector('#fionaProfileBests').onclick=()=>window.FionaMigrationUI.openAthleteProfile('Fiona Matt');
  updateProfile();updateRoad();setInterval(()=>{updateRoad();updateProfile();},60000);
  intro();
})();
