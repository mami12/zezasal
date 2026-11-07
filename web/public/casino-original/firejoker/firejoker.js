(() => {
  'use strict';

  // Config injected by originalClientShell
  const config = window.casinoWalletConfig || {};
  // Demo mode: opened with ?demo=1 -> uses the isolated virtual-credit router
  // (app.use('/app/api/casino/firejoker', ...) in server/index.mjs). Otherwise
  // it talks to the wallet-authenticated original game route.
  const demoMode = new URLSearchParams(window.location.search).get('demo') === '1';
  const serverUrl = config.serverUrl
    || (demoMode ? '/app/api/casino/firejoker/rgsm' : '/app/api/casino/original/firejoker/rgsm');

  // DOM Elements
  const balanceEl = document.getElementById('balance');
  const roundLabelEl = document.getElementById('round-label');
  const roundStateEl = document.getElementById('round-state');
  const reelsEl = document.getElementById('reels');
  const winMessageEl = document.getElementById('win-message');
  const lineBetSelect = document.getElementById('line-bet');
  const stakeTotalEl = document.getElementById('stake-total');
  const spinBtn = document.getElementById('spin');
  const autoSpinBtn = document.getElementById('auto-spin');
  const autoSpinLabelEl = document.getElementById('auto-spin-label');
  const autoSpinHintEl = document.getElementById('auto-spin-hint');
  const statusEl = document.getElementById('status');
  const stageEl = document.querySelector('.fj-stage');

  // Payline definitions: 5 lines across 5 reels, 3 rows (0=top, 1=mid, 2=bot)
  const LINES = [
    [1, 1, 1, 1, 1], // Line 1: Middle
    [0, 0, 0, 0, 0], // Line 2: Top
    [2, 2, 2, 2, 2], // Line 3: Bottom
    [0, 1, 2, 1, 0], // Line 4: V-shape
    [2, 1, 0, 1, 2], // Line 5: Inverted V
  ];

  const LINE_COLORS = ['#ffd700', '#00e5ff', '#ff3366', '#39ff14', '#ff8800'];

  // State
  let sequenceNumber = 0;
  let currentCreditCents = 0;
  let currencyCode = 'ALL';
  let denomCents = 4; // default 0.04 ALL
  let selectedLineBet = 100;
  let isSpinning = false;
  let isAutoSpinning = false;
  let autoSpinsRemaining = 0;
  const AUTO_SPIN_COUNT = 10;
  let gameConfig = null;
  let currentGrid = [
    ['symbol0', 'symbol1', 'symbol2', 'symbol3', 'symbol4'],
    ['symbol1', 'symbol2', 'symbol3', 'symbol4', 'symbol0'],
    ['symbol2', 'symbol3', 'symbol4', 'symbol0', 'symbol1'],
  ];

  function syncSpinControls() {
    const canStopAuto = isAutoSpinning;
    spinBtn.disabled = isSpinning || isAutoSpinning;
    lineBetSelect.disabled = isSpinning || isAutoSpinning;
    autoSpinBtn.disabled = isSpinning && !canStopAuto;
    autoSpinBtn.setAttribute('aria-pressed', String(isAutoSpinning));
    autoSpinBtn.setAttribute('aria-label', isAutoSpinning
      ? `Stop automatic spins (${autoSpinsRemaining} remaining)`
      : `Start ${AUTO_SPIN_COUNT} automatic spins`);
    autoSpinBtn.classList.toggle('is-active', isAutoSpinning);
    autoSpinLabelEl.textContent = isAutoSpinning ? 'STOP' : 'AUTO';
    autoSpinHintEl.textContent = isAutoSpinning ? `${autoSpinsRemaining} LEFT` : `${AUTO_SPIN_COUNT} SPINS`;
  }

  // SVG Overlay for paylines
  let svgOverlay = null;

  // ---- Sound System: real Play'n GO sprite via Web Audio API ----
  // Sprite timings extracted from config_desktop.json (samples @ 44100 Hz → seconds = samples/44100)
  const SPRITE = {
    // sounds_desktop.mp3
    reelStart:      [5225850, 5227973],
    reelLoop:       [5272073, 5288073],
    reelStop:       [5332173, 5349554],
    winSoundOne:    [6438945, 6506744],
    winSoundTwo:    [6550844, 6649707],
    winSoundThree:  [6693807, 6793797],
    winSoundFour:   [6837897, 6942052],
    winSoundFive:   [6986152, 7137238],
    bonusStart:     [10297690, 10408722],
    bonusWheelStop: [11184340, 11330514],
  };
  const SR = 44100; // sprite sample rate
  function spriteTime(samples) { return samples / SR; }

  let audioCtx = null;
  let soundBuffer = null;
  let soundLoading = false;

  function getAudioContext() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function loadSoundSprite() {
    if (soundBuffer || soundLoading) return;
    soundLoading = true;
    const ctx = getAudioContext();
    if (!ctx) return;
    fetch('./assets/sounds_desktop.mp3')
      .then(r => r.arrayBuffer())
      .then(ab => ctx.decodeAudioData(ab))
      .then(buf => { soundBuffer = buf; soundLoading = false; })
      .catch(() => { soundLoading = false; }); // graceful – fallback to silence
  }

  // ---- Synthetic fallback sounds (Web Audio) used when the MP3 sprite is absent ----
  // Produces recognizable slot-machine style tones using oscillators + noise, so the game
  // is audible out of the box. If assets/sounds_desktop.mp3 is later supplied, it wins.
  function playTone({ freq = 440, duration = 0.15, type = 'sine', volume = 0.25, sweepTo = null, noise = false } = {}) {
    const ctx = getAudioContext();
    if (!ctx) return null;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    gain.connect(ctx.destination);

    if (noise) {
      const bufferSize = Math.floor(ctx.sampleRate * duration);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(freq, now);
      if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, now + duration);
      src.connect(filter);
      filter.connect(gain);
      src.start(now);
      src.stop(now + duration);
      return src;
    }

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, now + duration);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + duration);
    return osc;
  }

  function playSprite(key) {
    const ctx = getAudioContext();
    if (!ctx) return null;
    if (soundBuffer) {
      const [startSample, endSample] = SPRITE[key] || [0, 0];
      const offset = spriteTime(startSample);
      const duration = spriteTime(endSample - startSample);
      if (duration > 0) {
        const src = ctx.createBufferSource();
        src.buffer = soundBuffer;
        const gain = ctx.createGain();
        gain.gain.value = 0.8;
        src.connect(gain);
        gain.connect(ctx.destination);
        src.start(0, offset, duration);
        return src;
      }
    }
    // Synthetic fallback per sprite key
    switch (key) {
      case 'reelStart':     return playTone({ freq: 300, sweepTo: 900, duration: 0.18, type: 'sawtooth', volume: 0.18 });
      case 'reelLoop':      return playTone({ freq: 600, duration: 0.12, type: 'triangle', volume: 0.10 });
      case 'reelStop':      return playTone({ freq: 200, sweepTo: 80, duration: 0.12, type: 'square', volume: 0.20 });
      case 'winSoundOne':   return playTone({ freq: 660, sweepTo: 880, duration: 0.20, type: 'sine', volume: 0.25 });
      case 'winSoundTwo':   { playTone({ freq: 660, duration: 0.12, type: 'sine', volume: 0.25 }); return playTone({ freq: 880, duration: 0.20, type: 'sine', volume: 0.25 }); }
      case 'winSoundThree': { playTone({ freq: 660, duration: 0.10, type: 'sine', volume: 0.25 }); setTimeout(() => playTone({ freq: 880, duration: 0.10, type: 'sine', volume: 0.25 }), 90); return playTone({ freq: 1320, duration: 0.22, type: 'sine', volume: 0.25 }); }
      case 'winSoundFour':  { [660, 880, 1100].forEach((f, i) => setTimeout(() => playTone({ freq: f, duration: 0.15, type: 'sine', volume: 0.25 }), i * 90)); return null; }
      case 'winSoundFive':  { [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => playTone({ freq: f, duration: 0.18, type: 'triangle', volume: 0.28 }), i * 110)); return null; }
      case 'bonusStart':    { playTone({ freq: 400, sweepTo: 1600, duration: 0.6, type: 'sawtooth', volume: 0.20 }); setTimeout(() => playTone({ freq: 800, sweepTo: 2000, duration: 0.5, type: 'triangle', volume: 0.18 }), 200); return null; }
      case 'bonusWheelStop':return playTone({ freq: 1000, sweepTo: 300, duration: 0.25, type: 'square', volume: 0.22 });
      default: return null;
    }
  }

  // Wire up the audio context on first user gesture
  function touchAudio() {
    getAudioContext();
    loadSoundSprite();
    document.removeEventListener('pointerdown', touchAudio, true);
    document.removeEventListener('keydown', touchAudio, true);
  }
  document.addEventListener('pointerdown', touchAudio, { capture: true, once: true });
  document.addEventListener('keydown', touchAudio, { capture: true, once: true });

  const Sound = {
    click()           { playSprite('winSoundOne'); },
    spin()            { playSprite('reelStart'); },
    stop(reelIndex)   { playSprite('reelStop'); },
    win()             { playSprite('winSoundThree'); },
    scatter()         { playSprite('bonusStart'); },
    freeSpins()       { playSprite('bonusStart'); },
    bigWin()          { playSprite('winSoundFive'); },
  };

  // Backend communication via XMLHttpRequest (so wallet-bridge.js intercepts mutating commands)
  function sendCtRequest(command, retry = 0) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const url = new URL(serverUrl, window.location.href);
      url.searchParams.set('request', JSON.stringify([command]));

      xhr.open('GET', url.href, true);
      xhr.setRequestHeader('Accept', 'application/json');

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            const response = Array.isArray(data) ? data[0] : data;
            if (response?.status?.status === 'user_error') {
              const error = new Error(response.status.msg || 'Game action rejected');
              error.response = response;
              reject(error);
            } else {
              resolve(response);
            }
          } catch (e) {
            reject(new Error('Invalid JSON response from server'));
          }
        } else if (xhr.status >= 500 && retry < 1) {
          setTimeout(() => sendCtRequest(command, retry + 1).then(resolve, reject), 350);
        } else {
          try {
            const err = JSON.parse(xhr.responseText);
            const error = new Error(err.message || err.error_txt || `Server error: ${xhr.status}`);
            error.response = err;
            reject(error);
          } catch {
            reject(new Error(`Server HTTP ${xhr.status}`));
          }
        }
      };

      xhr.onerror = () => {
        if (retry < 1) setTimeout(() => sendCtRequest(command, retry + 1).then(resolve, reject), 350);
        else reject(new Error('Network connection error'));
      };
      xhr.ontimeout = () => {
        if (retry < 1) setTimeout(() => sendCtRequest(command, retry + 1).then(resolve, reject), 350);
        else reject(new Error('Request timeout'));
      };
      xhr.timeout = 15000;
      xhr.send();
    });
  }

  // Format currency
  function formatMoney(cents) {
    return (Number(cents) / 100).toFixed(2);
  }

  function updateBalanceDisplay(creditCents) {
    currentCreditCents = creditCents;
    if (balanceEl) {
      balanceEl.textContent = formatMoney(creditCents);
    }
  }

  function updateStakeTotal() {
    const totalBetCredits = selectedLineBet * 5;
    const stakeCents = Math.round(totalBetCredits * denomCents);
    if (stakeTotalEl) {
      stakeTotalEl.textContent = `${formatMoney(stakeCents)} ${currencyCode}`;
    }
  }

  // Create or retrieve Paylines SVG overlay
  function getPaylinesOverlay() {
    if (!svgOverlay && reelsEl) {
      svgOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svgOverlay.setAttribute('class', 'fj-paylines-overlay');
      reelsEl.appendChild(svgOverlay);
    }
    return svgOverlay;
  }

  function clearPaylines() {
    if (svgOverlay) {
      while (svgOverlay.firstChild) svgOverlay.removeChild(svgOverlay.firstChild);
    }
    document.querySelectorAll('.fj-cell.winning').forEach(cell => cell.classList.remove('winning'));
  }

  // Render SVG payline connecting reel cell centers
  function drawPayline(lineIndex, winningCellsCount) {
    const overlay = getPaylinesOverlay();
    if (!overlay || !reelsEl) return;

    const line = LINES[lineIndex];
    if (!line) return;

    const reelCols = reelsEl.querySelectorAll('.fj-reel-col');
    if (reelCols.length < 5) return;

    const points = [];
    const count = winningCellsCount || 5;

    for (let reel = 0; reel < count; reel++) {
      const col = reelCols[reel];
      const row = line[reel];
      const cells = col.querySelectorAll('.fj-cell');
      const cell = cells[row];
      if (cell) {
        cell.classList.add('winning');
        const colRect = col.getBoundingClientRect();
        const cellRect = cell.getBoundingClientRect();
        const reelBox = reelsEl.getBoundingClientRect();

        const x = colRect.left - reelBox.left + colRect.width / 2;
        const y = cellRect.top - reelBox.top + cellRect.height / 2;
        points.push({ x, y });
      }
    }

    if (points.length < 2) return;

    let pathD = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cx = (prev.x + curr.x) / 2;
      pathD += ` C ${cx} ${prev.y}, ${cx} ${curr.y}, ${curr.x} ${curr.y}`;
    }

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathD);
    path.setAttribute('class', 'fj-payline-path');
    path.setAttribute('stroke', LINE_COLORS[lineIndex % LINE_COLORS.length]);
    path.setAttribute('stroke-dasharray', '8 4');
    overlay.appendChild(path);
  }

  // Symbol image mapping — use the original Play'n GO PNG sprites.
  // The hand-drawn SVGs were placeholders and have been moved to
  // assets/symbols/.legacy-svg/ (they remain on disk for rollback).
  function symbolImageSrc(symbolKey) {
    const num = String(symbolKey).replace(/\D/g, '');
    const id = num ? Number(num) : 0;
    return `./assets/symbols/symbol${id}.png`;
  }

  // Build reel columns in DOM
  function setupReelsDOM() {
    reelsEl.innerHTML = '';
    for (let reel = 0; reel < 5; reel++) {
      const col = document.createElement('div');
      col.className = 'fj-reel-col';
      col.dataset.reel = reel;

      const strip = document.createElement('div');
      strip.className = 'fj-reel-strip';

      for (let row = 0; row < 3; row++) {
        const cell = document.createElement('div');
        cell.className = 'fj-cell';
        cell.dataset.row = row;

        const img = document.createElement('img');
        const sym = currentGrid[row]?.[reel] || 'symbol0';
        img.src = symbolImageSrc(sym);
        img.alt = sym;
        cell.appendChild(img);
        strip.appendChild(cell);
      }

      col.appendChild(strip);
      reelsEl.appendChild(col);
    }
  }

  // Update visible symbols in grid
  function setGridSymbols(rows) {
    currentGrid = rows;
    const cols = reelsEl.querySelectorAll('.fj-reel-col');
    cols.forEach((col, reelIdx) => {
      const cells = col.querySelectorAll('.fj-cell img');
      cells.forEach((img, rowIdx) => {
        const sym = rows[rowIdx]?.[reelIdx] || 'symbol0';
        img.src = symbolImageSrc(sym);
        img.alt = sym;
      });
    });
  }

  // Animated spin implementation
  async function animateReels(targetRows) {
    clearPaylines();
    Sound.spin();

    const cols = reelsEl.querySelectorAll('.fj-reel-col');
    const strips = [];

    // Setup extra spinning symbols on each strip for smooth reel spin illusion
    cols.forEach((col, reelIdx) => {
      const strip = col.querySelector('.fj-reel-strip');
      strip.innerHTML = '';

      // Random symbols buffer
      const buffer = [];
      const totalSpinSymbols = 18 + reelIdx * 6;
      for (let i = 0; i < totalSpinSymbols; i++) {
        const randSym = `symbol${Math.floor(Math.random() * 9)}`;
        buffer.push(randSym);
      }

      // Final 3 symbols at the top/stopping point
      buffer.push(targetRows[0][reelIdx]);
      buffer.push(targetRows[1][reelIdx]);
      buffer.push(targetRows[2][reelIdx]);

      buffer.forEach((sym, idx) => {
        const cell = document.createElement('div');
        cell.className = 'fj-cell';
        const img = document.createElement('img');
        img.src = symbolImageSrc(sym);
        img.alt = sym;
        cell.appendChild(img);
        strip.appendChild(cell);
      });

      strips.push({ strip, count: buffer.length });
    });

    // Animate each column sequentially
    const cellHeight = cols[0].querySelector('.fj-cell').offsetHeight || 121;
    const promises = strips.map(({ strip, count }, reelIdx) => {
      return new Promise(resolve => {
        const finalY = -((count - 3) * cellHeight);
        const duration = 900 + reelIdx * 200;

        strip.style.transition = `transform ${duration}ms cubic-bezier(0.12, 0.8, 0.32, 1)`;
        strip.style.transform = `translateY(${finalY}px)`;

        setTimeout(() => {
          Sound.stop(reelIdx);
          resolve();
        }, duration);
      });
    });

    await Promise.all(promises);

    // Reset strips to normal 3 cells
    setGridSymbols(targetRows);
    strips.forEach(({ strip }) => {
      strip.style.transition = 'none';
      strip.style.transform = 'translateY(0px)';
    });
  }

  // Display winning lines and celebratory effects
  function displayWins(linesWin, scattersWin, totalWinCents) {
    clearPaylines();

    if (scattersWin && scattersWin.length > 0) {
      Sound.scatter();
      scattersWin.forEach(sw => {
        if (Array.isArray(sw.positions)) {
          sw.positions.forEach(([row, reel]) => {
            const col = reelsEl.querySelector(`.fj-reel-col[data-reel="${reel}"]`);
            const cell = col?.querySelector(`.fj-cell[data-row="${row}"]`);
            if (cell) cell.classList.add('winning');
          });
        }
      });
    }

    if (linesWin && linesWin.length > 0) {
      Sound.win();
      linesWin.forEach(win => {
        drawPayline(win.line_number, win.symbol_count);
      });
    }

    if (totalWinCents > 0) {
      const winFormatted = formatMoney(totalWinCents);
      winMessageEl.textContent = `WIN: ${winFormatted} ${currencyCode}!`;
      winMessageEl.classList.add('big');
      if (statusEl) statusEl.textContent = `You won ${winFormatted} ${currencyCode}!`;
    } else {
      winMessageEl.textContent = 'Fire Joker';
      winMessageEl.classList.remove('big');
      if (statusEl) statusEl.textContent = 'Good luck!';
    }
  }

  // Show free games announcement banner
  function showFreeGamesBanner(count) {
    return new Promise(resolve => {
      const banner = document.createElement('div');
      banner.className = 'fj-freegame-banner';

      const title = document.createElement('div');
      title.className = 'fj-freegame-title';
      title.textContent = `${count} FREE SPINS!`;

      const sub = document.createElement('div');
      sub.className = 'fj-freegame-sub';
      sub.textContent = 'BONUS REELS ACTIVATED';

      banner.appendChild(title);
      banner.appendChild(sub);
      stageEl.appendChild(banner);

      Sound.scatter();

      setTimeout(() => {
        banner.remove();
        resolve();
      }, 2200);
    });
  }

  // Execute paid spin and handle free spins chain
  async function performSpin() {
    if (isSpinning) return false;
    isSpinning = true;
    syncSpinControls();
    clearPaylines();

    winMessageEl.textContent = 'SPINNING...';
    winMessageEl.classList.remove('big');
    roundStateEl.textContent = 'SPINNING';

    const stakeCredits = selectedLineBet * 5;
    const stakeCents = Math.round(stakeCredits * denomCents);
    let spinCompleted = false;

    try {
      const playResp = await sendCtRequest({
        command: 'play',
        sequence_number: sequenceNumber++,
        lines: 5,
        line_bet: selectedLineBet,
        total_bet: stakeCredits,
        game_denom: 1,
      });

      const subgames = playResp.result || [];
      // The server is authoritative; reflect the debit as soon as it confirms
      // the spin, instead of guessing before the wallet request completes.
      if (playResp.account_status?.credit != null) {
        updateBalanceDisplay(playResp.account_status.credit);
      }
      const mainSubgame = subgames[0];
      if (!mainSubgame) throw new Error('No game result returned');

      // 1. Animate base game reels
      await animateReels(mainSubgame.result_reels);

      // Display base game wins
      const baseWinCents = Math.round(Number(mainSubgame.win || 0) * denomCents);
      displayWins(mainSubgame.lines_win, mainSubgame.scatters_win, baseWinCents);

      // 2. Free Spins chain if awarded
      const freeGames = subgames.filter(sg => sg.is_free === 1);
      if (freeGames.length > 0) {
        await new Promise(r => setTimeout(r, 1200));
        await showFreeGamesBanner(freeGames.length);

        for (let i = 0; i < freeGames.length; i++) {
          const fg = freeGames[i];
          roundStateEl.textContent = `FREE SPIN ${fg.free_game_number} / ${fg.free_game_total}`;
          roundLabelEl.textContent = 'BONUS ROUND';

          await animateReels(fg.result_reels);

          const fgWinCents = Math.round(Number(fg.win || 0) * denomCents);
          const runningTotalCents = Math.round(Number(fg.total_win || 0) * denomCents);
          displayWins(fg.lines_win, fg.scatters_win, runningTotalCents);

          await new Promise(r => setTimeout(r, 1000));
        }
      }

      // 3. Complete round with game_finished
      const finishResp = await sendCtRequest({
        command: 'game_finished',
        sequence_number: sequenceNumber++,
        gameplay_id: playResp.gameplay_id,
      });

      if (finishResp?.account_status?.credit != null) {
        updateBalanceDisplay(finishResp.account_status.credit);
      }

      const totalWinCents = Math.round(Number(subgames.at(-1)?.total_win || 0) * denomCents);
      if (totalWinCents > 0) {
        winMessageEl.textContent = `TOTAL WIN: ${formatMoney(totalWinCents)} ${currencyCode}!`;
        winMessageEl.classList.add('big');
      }

      roundStateEl.textContent = 'READY';
      roundLabelEl.textContent = '5 FIXED LINES';
      spinCompleted = true;

    } catch (err) {
      console.error('[Fire Joker error]', err);
      if (err.response?.account_status?.credit != null) {
        updateBalanceDisplay(err.response.account_status.credit);
      }
      winMessageEl.textContent = 'ERROR';
      if (statusEl) statusEl.textContent = err.message || 'Error executing spin';
      roundStateEl.textContent = 'ERROR';
    } finally {
      isSpinning = false;
      syncSpinControls();
    }
    return spinCompleted;
  }

  async function runAutoSpins() {
    while (isAutoSpinning && autoSpinsRemaining > 0) {
      const completed = await performSpin();
      if (!completed) {
        isAutoSpinning = false;
        break;
      }

      autoSpinsRemaining -= 1;
      syncSpinControls();
      if (isAutoSpinning && autoSpinsRemaining > 0) {
        await new Promise(resolve => setTimeout(resolve, 350));
      }
    }

    isAutoSpinning = false;
    autoSpinsRemaining = 0;
    syncSpinControls();
  }

  function toggleAutoSpins() {
    Sound.click();
    if (isAutoSpinning) {
      isAutoSpinning = false;
      syncSpinControls();
      return;
    }
    if (isSpinning || spinBtn.disabled) return;

    isAutoSpinning = true;
    autoSpinsRemaining = AUTO_SPIN_COUNT;
    syncSpinControls();
    runAutoSpins();
  }

  // Initialize session and game config
  async function initGame() {
    try {
      roundStateEl.textContent = 'CONNECTING';
      if (statusEl) statusEl.textContent = 'Connecting to game server...';

      // 1. Create Session
      const sessionData = await sendCtRequest({
        command: 'create_session',
        sequence_number: sequenceNumber++,
      });

      if (sessionData.account_status) {
        currencyCode = sessionData.account_status.currency || 'ALL';
        updateBalanceDisplay(sessionData.account_status.credit ?? 0);
      }

      if (sessionData.enabled_denoms?.length) {
        denomCents = sessionData.enabled_denoms[0].cents;
      }

      // 2. Init Game
      const initData = await sendCtRequest({
        command: 'init_game',
        sequence_number: sequenceNumber++,
      });

      gameConfig = initData.game_config;

      // Populate Bet Selector
      const bets = gameConfig.line_step_bet_numbers || [100, 250, 500, 1000, 2500, 5000, 12500, 25000];
      lineBetSelect.innerHTML = '';
      bets.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b;
        const totalStake = (b * 5 * denomCents) / 100;
        opt.textContent = `${totalStake.toFixed(2)} ${currencyCode}`;
        lineBetSelect.appendChild(opt);
      });

      selectedLineBet = bets[0];
      lineBetSelect.value = selectedLineBet;
      updateStakeTotal();

      lineBetSelect.addEventListener('change', () => {
        Sound.click();
        selectedLineBet = Number(lineBetSelect.value);
        updateStakeTotal();
      });

      // Initial Screen Setup
      if (gameConfig.init_screen) {
        currentGrid = gameConfig.init_screen;
      }
      setupReelsDOM();

      roundStateEl.textContent = 'READY';
      if (statusEl) statusEl.textContent = 'Ready to play! Press SPIN to start.';
      syncSpinControls();

    } catch (err) {
      console.error('[Fire Joker Init Error]', err);
      roundStateEl.textContent = 'OFFLINE';
      if (statusEl) statusEl.textContent = `Initialization failed: ${err.message}`;
    }
  }

  // Event Listeners
  spinBtn.addEventListener('click', () => {
    Sound.click();
    performSpin();
  });

  autoSpinBtn.addEventListener('click', toggleAutoSpins);

  window.addEventListener('keydown', e => {
    if ((e.code === 'Space' || e.code === 'Enter') && !spinBtn.disabled && !isSpinning) {
      e.preventDefault();
      Sound.click();
      performSpin();
    }
  });

  // Start initialization
  initGame();
})();
