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
  intro();
})();
