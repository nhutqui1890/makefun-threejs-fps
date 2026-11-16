// Every pixel of interface: the HUD readouts, the crosshair, the kill feed, the
// buy menu, the scoreboard, the minimap and the overlay screens. It only writes
// the DOM when a value changes, and the minimap is one small canvas redrawn from
// the world's wall list each frame.
import { WEAPONS, GRENADE } from './weapons.js';

const BUY_ITEMS = [
  { id: 'vk9', key: '1' },
  { id: 'ar77', key: '2' },
  { id: 'lw50', key: '3' },
  { id: 'frag', key: '4' },
  { id: 'kevlar', key: '5' },
];
const KEVLAR = { id: 'kevlar', name: 'Kevlar Vest', price: 650 };

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const els = {
    hud: $('hud'),
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    health: $('health-value'),
    armor: $('armor-value'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    weaponName: $('weapon-name'),
    grenades: $('grenades-value'),
    money: $('money-value'),
    timer: $('timer-value'),
    scoreV: $('score-v'),
    scoreS: $('score-s'),
    round: $('round-value'),
    killfeed: $('killfeed'),
    minimap: $('minimap'),
    banner: $('banner'),
    bannerText: $('banner-text'),
    bannerSub: $('banner-sub'),
    message: $('message'),
    bombBar: $('bomb-bar'),
    bombFill: $('bomb-fill'),
    bombLabel: $('bomb-label'),
    buyMenu: $('buy-menu'),
    buyItems: $('buy-items'),
    buyMoney: $('buy-money'),
    scoreboard: $('scoreboard'),
    scoreRows: $('scoreboard-rows'),
    damage: $('damage-vignette'),
    hint: $('hint'),
    overlay: $('overlay'),
    overlayTitle: $('overlay-title'),
    overlayCopy: $('overlay-copy'),
    overlayExtra: $('overlay-extra'),
    play: $('play'),
  };
  const minimapCtx = els.minimap.getContext('2d');
  const last = {};
  let hitTimer = 0;
  let bannerTimer = 0;
  let messageTimer = 0;

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  function renderBuyItems(money, owned, grenades) {
    els.buyItems.innerHTML = '';
    for (const item of BUY_ITEMS) {
      const def = item.id === 'frag' ? GRENADE : item.id === 'kevlar' ? KEVLAR : WEAPONS[item.id];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'buy-item';
      button.dataset.buy = item.id;
      const have = item.id === 'frag' ? grenades > 0 : item.id === 'kevlar' ? false : !!owned[item.id];
      const afford = money >= def.price;
      if (have) button.classList.add('owned');
      if (!afford && !have) button.classList.add('poor');
      const stat = def.mag ? `${def.damage} dmg · ${def.mag} rnd` : item.id === 'frag' ? 'blast radius 5.5 m' : '+50 armour';
      button.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${def.name}</span><span class="buy-stat">${stat}</span><span class="buy-price">$${def.price}</span>`;
      els.buyItems.appendChild(button);
    }
    setText(els.buyMoney, 'buyMoney', `$${money}`);
  }

  return {
    onPlay(handler) {
      els.play.addEventListener('click', handler);
    },
    onBuy(handler) {
      els.buyItems.addEventListener('click', (event) => {
        const button = event.target.closest('[data-buy]');
        if (button) handler(button.dataset.buy);
      });
    },
    setHealth(health, armor) {
      setText(els.health, 'health', String(Math.max(0, Math.ceil(health))));
      setText(els.armor, 'armor', String(Math.max(0, Math.ceil(armor))));
      els.health.parentElement.classList.toggle('low', health <= 30);
      // Below 30 HP the red vignette stays on until healed: a hurt player
      // should feel hurt, not just flash once.
      els.damage.classList.toggle('lowhp', health > 0 && health <= 30);
    },
    setAmmo(mag, reserve, weaponName, grenades) {
      setText(els.ammoMag, 'mag', String(mag));
      setText(els.ammoReserve, 'reserve', `/ ${reserve}`);
      setText(els.weaponName, 'weapon', weaponName);
      setText(els.grenades, 'grenades', grenades > 0 ? `◉ ${grenades}` : '◉ 0');
      els.ammoMag.parentElement.classList.toggle('empty', mag === 0);
    },
    setMoney(money) {
      setText(els.money, 'money', `$${money}`);
    },
    setTimer(seconds, urgent) {
      const s = Math.max(0, Math.ceil(seconds));
      const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      setText(els.timer, 'timer', text);
      els.timer.classList.toggle('urgent', !!urgent && s <= 15);
    },
    setScores(vanguard, sentinel, round) {
      setText(els.scoreV, 'scoreV', String(vanguard));
      setText(els.scoreS, 'scoreS', String(sentinel));
      setText(els.round, 'round', `ROUND ${round}`);
    },
    setCrosshairSpread(px) {
      els.crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
    },
    hitmarker(kill, hold) {
      els.hitmarker.classList.add('on');
      els.hitmarker.classList.toggle('kill', kill);
      clearTimeout(hitTimer);
      // hold: the marker stays up until the next hitmarker call. Only the
      // screenshot staging uses it, to freeze a hit on screen.
      if (!hold) hitTimer = setTimeout(() => els.hitmarker.classList.remove('on', 'kill'), kill ? 220 : 110);
    },
    killfeed(killer, victim, killerTeam, headshot, hold) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      const killerSpan = `<span class="feed-${killerTeam}">${killer}</span>`;
      const victimSpan = `<span class="feed-${killerTeam === 'vanguard' ? 'sentinel' : 'vanguard'}">${victim}</span>`;
      line.innerHTML = `${killerSpan} <span class="feed-weapon">${headshot ? '◎' : '—'}</span> ${victimSpan}`;
      els.killfeed.prepend(line);
      while (els.killfeed.children.length > 5) els.killfeed.removeChild(els.killfeed.lastChild);
      // hold: the line stays until cleared. Only the screenshot staging uses
      // it — a software-rendered capture can take longer than the 6 s a live
      // feed line lives, and the shot would lose it.
      if (!hold) setTimeout(() => line.remove(), 6000);
    },
    clearKillfeed() {
      els.killfeed.innerHTML = '';
    },
    banner(text, sub, team, hold) {
      els.bannerText.textContent = text;
      els.bannerSub.textContent = sub || '';
      els.banner.className = `show ${team || ''}`;
      clearTimeout(bannerTimer);
      if (!hold) bannerTimer = setTimeout(() => els.banner.classList.remove('show'), 3200);
    },
    message(text, ms = 2600) {
      els.message.textContent = text;
      els.message.classList.add('show');
      clearTimeout(messageTimer);
      messageTimer = setTimeout(() => els.message.classList.remove('show'), ms);
    },
    setBomb(site, fraction) {
      els.bombBar.classList.add('show');
      els.bombLabel.textContent = site ? `CHARGE AT SITE ${site} — DEFUSE IT` : 'CHARGE PLANTED';
      els.bombFill.style.width = `${Math.round(fraction * 100)}%`;
    },
    clearBomb() {
      els.bombBar.classList.remove('show');
    },
    showBuyMenu(money, owned, grenades) {
      renderBuyItems(money, owned, grenades);
      els.buyMenu.classList.add('show');
    },
    updateBuyMenu(money, owned, grenades) {
      if (els.buyMenu.classList.contains('show')) renderBuyItems(money, owned, grenades);
    },
    hideBuyMenu() {
      els.buyMenu.classList.remove('show');
    },
    buyMenuOpen() {
      return els.buyMenu.classList.contains('show');
    },
    showScoreboard(rows) {
      els.scoreRows.innerHTML = '';
      for (const team of ['vanguard', 'sentinel']) {
        const header = document.createElement('div');
        header.className = `score-team score-team-${team}`;
        header.textContent = team === 'vanguard' ? 'VANGUARD — ATTACK' : 'SENTINEL — DEFEND';
        els.scoreRows.appendChild(header);
        for (const row of rows.filter((r) => r.team === team)) {
          const line = document.createElement('div');
          line.className = 'score-row';
          line.innerHTML = `<span class="score-name">${row.alive ? '' : '✕ '}${row.name}${row.isPlayer ? ' (you)' : ''}</span><span>${row.kills}</span><span>${row.deaths}</span><span>$${row.money}</span>`;
          els.scoreRows.appendChild(line);
        }
      }
      els.scoreboard.classList.add('show');
    },
    hideScoreboard() {
      els.scoreboard.classList.remove('show');
    },
    damageFlash() {
      els.damage.classList.add('on');
      setTimeout(() => els.damage.classList.remove('on'), 180);
    },
    setHint(text) {
      setText(els.hint, 'hint', text || '');
    },
    showOverlay(kind, data) {
      const d = data || {};
      els.overlay.hidden = false;
      if (kind === 'start') {
        els.overlayTitle.textContent = 'RIDGEPOINT';
        els.overlayCopy.textContent = 'A round-based tactical shooter. Vanguard plants the charge at Site A or B; Sentinel holds the outpost. First to 5 rounds takes the match.';
        els.overlayExtra.innerHTML = '<span>4 v 4 · bots on both sides · buy between rounds · accuracy beats spray</span>';
        els.play.textContent = 'Click to play';
      } else if (kind === 'paused') {
        els.overlayTitle.textContent = 'Paused';
        els.overlayCopy.textContent = 'The round is waiting. Click to get back in.';
        els.overlayExtra.innerHTML = '';
        els.play.textContent = 'Resume';
      } else if (kind === 'roundEnd') {
        els.overlayTitle.textContent = d.title || 'Round over';
        els.overlayCopy.textContent = d.copy || '';
        els.overlayExtra.innerHTML = d.extra || '';
        els.play.textContent = 'Next round';
      } else if (kind === 'matchEnd') {
        els.overlayTitle.textContent = d.title || 'Match over';
        els.overlayCopy.textContent = d.copy || '';
        els.overlayExtra.innerHTML = d.extra || '';
        els.play.textContent = 'Play again';
      }
    },
    hideOverlay() {
      els.overlay.hidden = true;
    },
    overlayVisible() {
      return !els.overlay.hidden;
    },
    drawMinimap(world, actors, bomb, player, spotted) {
      const ctx = minimapCtx;
      const w = els.minimap.width;
      const h = els.minimap.height;
      const px = (x) => ((x + 32) / 64) * w;
      const pz = (z) => ((z + 22) / 44) * h;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(20,16,12,0.72)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#5d4c38';
      for (const wall of world.minimapWalls) {
        ctx.fillRect(px(wall.x - wall.w / 2), pz(wall.z - wall.d / 2), (wall.w / 64) * w, (wall.d / 44) * h);
      }
      for (const site of world.sites) {
        ctx.fillStyle = '#e8a33d';
        ctx.beginPath();
        ctx.arc(px(site.x), pz(site.z), 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#191410';
        ctx.font = 'bold 7px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(site.id, px(site.x), pz(site.z));
      }
      if (bomb.planted || bomb.dropped) {
        ctx.fillStyle = '#d84a3a';
        ctx.beginPath();
        ctx.arc(px(bomb.x), pz(bomb.z), 4, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const actor of actors) {
        if (!actor.alive) continue;
        const isPlayer = actor.isPlayer;
        const isTeammate = actor.team === player.team;
        if (!isPlayer && !isTeammate && !spotted.has(actor)) continue;
        ctx.fillStyle = isPlayer ? '#ffffff' : isTeammate ? (actor.team === 'vanguard' ? '#e8a33d' : '#3fb8a8') : '#d84a3a';
        ctx.beginPath();
        ctx.arc(px(actor.position.x), pz(actor.position.z), isPlayer ? 3.5 : 3, 0, Math.PI * 2);
        ctx.fill();
      }
      if (player.alive) {
        const cx = px(player.position.x);
        const cz = pz(player.position.z);
        const fx = -Math.sin(player.yaw);
        const fz = -Math.cos(player.yaw);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, cz);
        ctx.lineTo(cx + fx * 8, cz + fz * 8);
        ctx.stroke();
      }
    },
  };
}
