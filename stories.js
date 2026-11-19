(() => {
  const config = window.FIONA_APP_CONFIG;
  const $ = id => document.getElementById(id);
  const journey = $('story-timeline');
  const season = $('story-year');
  const preview = $('story-preview');
  const share = $('story-share');
  const download = $('story-download');
  const status = $('story-export-status');
  const [semifinal, final] = config.dakarResults;
  const dakar = config.milestones.find(moment => moment.date === '2026-11-08');
  const seasonYears = [...new Set(config.milestones.map(moment => moment.date.slice(0, 4)))].reverse();
  const date = new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  const number = decimals => new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals
  });
  const time = round => number(2).format(Number(round.result)) + ' s';
  const wind = round => (round.wind < 0 ? '−' : '+') + number(1).format(Math.abs(round.wind)) + ' m/s';

  function element(tag, content, className) {
    const node = document.createElement(tag);
    if (content) node.textContent = content;
    if (className) node.className = className;
    return node;
  }

  function renderJourney() {
    journey.replaceChildren();
    for (const moment of config.milestones.filter(item => item.date.startsWith(season.value))) {
      const item = element('li');
      const emblem = element('img');
      emblem.src = moment.emblem;
      emblem.alt = '';
      const body = element('div');
      const day = element('time', date.format(new Date(moment.date)));
      day.dateTime = moment.date;
      body.append(day, element('h4', moment.title));
      if (moment === dakar) {
        body.append(element('p', '100 m · Dakar · ' + time(final) + ' (' + wind(final) + ')'));
        const recap = element('button', 'Dakar-Rückblick ansehen →', 'tab');
        recap.type = 'button';
        recap.dataset.storyPanel = 'recap';
        body.append(recap);
      } else {
        body.append(element('p', moment.detail));
        if (moment.status === 'verletzt') body.append(element('p', 'Verletzungsbedingter Startverzicht', 'story-note'));
        if (moment.source) {
          const source = element('a', 'Quelle ansehen');
          source.href = moment.source;
          body.append(source);
        }
      }
      item.append(emblem, body);
      journey.append(item);
    }
  }

  function renderRounds() {
    const semifinalSource = 'https://worldathletics.org/competitions/youth-olympic-games/youth-olympic-games-7147638/results/women/100-metres/semi-finals/result';
    for (const [round, name, source] of [[semifinal, 'Halbfinale 1', semifinalSource], [final, 'Finale', dakar.source]]) {
      const item = element('article', null, 'story-round');
      const link = element('a', 'Offizielles Resultat');
      link.href = source;
      const note = round.windAssisted ? ' · windunterstützt' : '';
      item.append(
        element('h4', name),
        element('strong', time(round)),
        element('p', round.fionaRank + '. Platz · ' + wind(round) + note),
        link
      );
      $('story-rounds').append(item);
    }
  }

  function loadImage(path) {
    const image = new Image();
    image.src = path;
    return image.decode().then(() => image);
  }

  function drawCard(photo, flag) {
    const ctx = preview.getContext('2d');
    const width = preview.width;
    const height = preview.height;
    const inset = 68;

    ctx.fillStyle = '#0c1c3d';
    ctx.fillRect(0, 0, width, height);
    if (photo) {
      const photoHeight = 940;
      const scale = Math.max(width / photo.width, photoHeight / photo.height);
      const scaledWidth = photo.width * scale;
      const scaledHeight = photo.height * scale;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, width, photoHeight);
      ctx.clip();
      ctx.drawImage(photo, (width - scaledWidth) / 2, (photoHeight - scaledHeight) * 0.27, scaledWidth, scaledHeight);
      ctx.restore();
      const shade = ctx.createLinearGradient(0, 450, 0, photoHeight);
      shade.addColorStop(0, 'rgba(12, 28, 61, 0)');
      shade.addColorStop(1, '#0c1c3d');
      ctx.fillStyle = shade;
      ctx.fillRect(0, 450, width, photoHeight - 450);
    }
    ctx.fillStyle = '#e43f51';
    ctx.fillRect(0, 0, width, 14);
    if (flag) ctx.drawImage(flag, inset, 748, 82, 49);

    function write(content, y, size, weight, color = '#ffffff') {
      ctx.font = weight + ' ' + size + 'px system-ui, sans-serif';
      ctx.fillStyle = color;
      ctx.fillText(content, inset, y, width - inset * 2);
    }

    write('FIONA MATT', 880, 86, 800);
    write('Youth Olympic Games · Dakar 2026', 953, 38, 600, '#cbd8f4');
    ctx.fillStyle = '#e43f51';
    ctx.fillRect(inset, 985, 100, 7);
    write(final.fionaRank + '. Platz', 1110, 108, 800);
    write('100 m Finale · ' + time(final) + ' · ' + wind(final), 1190, 44, 700);
    write('08.11.2026 · Liechtenstein · windunterstützt', 1275, 34, 500, '#cbd8f4');
  }

  let exportPending = false;
  async function prepareCard() {
    if (exportPending || download.href) return;
    exportPending = true;
    status.textContent = 'Erfolgskarte wird vorbereitet …';
    try {
      const [photo, flag] = await Promise.all([
        loadImage(config.dakarStory.cardPhoto).catch(() => null),
        loadImage('./assets/liechtenstein-flag.webp').catch(() => null)
      ]);
      drawCard(photo, flag);
      const blob = await new Promise(resolve => preview.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('PNG unavailable');
      download.href = URL.createObjectURL(blob);
      download.hidden = false;
      const file = new File([blob], download.download, { type: blob.type });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        share.hidden = false;
        share.onclick = async () => {
          try {
            await navigator.share({ files: [file], title: 'Fiona Matt · Dakar 2026' });
          } catch (error) {
            if (error.name !== 'AbortError') status.textContent = 'Bitte lade das PNG herunter, um es zu teilen.';
          }
        };
      }
      status.textContent = '';
    } catch {
      status.textContent = 'Die Erfolgskarte konnte nicht geladen werden. Öffne den Bereich erneut, um es nochmals zu versuchen.';
    } finally {
      exportPending = false;
    }
  }

  function selectPanel(panel) {
    for (const button of document.querySelectorAll('[data-story-tab]')) {
      const active = button.dataset.storyTab === panel;
      button.setAttribute('aria-pressed', active);
      button.classList.toggle('active', active);
      $('story-' + button.dataset.storyTab).hidden = !active;
    }
    if (panel === 'card') prepareCard();
  }

  const { reflection, videoUrl } = config.dakarStory;
  if (reflection) {
    $('story-reflection').querySelector('p').textContent = reflection;
    $('story-reflection').hidden = false;
  }
  if (videoUrl) {
    $('story-video').href = videoUrl;
    $('story-video').hidden = false;
  }

  for (const year of seasonYears) season.add(new Option(year, year));
  season.addEventListener('change', renderJourney);
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-story-panel], [data-story-tab]');
    if (!button) return;
    const panel = button.dataset.storyPanel || button.dataset.storyTab;
    selectPanel(panel);
    if (!button.dataset.storyTab) {
      const heading = $('story-' + panel).querySelector('h3');
      heading.tabIndex = -1;
      heading.focus();
    }
  });
  renderJourney();
  renderRounds();
  selectPanel('journey');
})();
