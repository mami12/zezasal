/**
 * Play'n GO Fire Joker 8.1.3 ContainerLauncher shim.
 *
 * The original Play'n GO client is a React "ContainerLauncher" that expects
 * two JSON endpoints on the same origin:
 *   GET /configuration/v2           -> resolved game configuration
 *   GET /configuration/prelaunchconfiguration -> error messages + language
 *
 * Those endpoints were served by Play'n GO's own gateway. We replace them
 * here with a minimal, same-origin implementation that reads the assets
 * already shipped in `provider-original/8.1.3-firejoker.292/`
 * (config_desktop.json, game_desktop_bundle.json, ui_desktop_bundle.json).
 *
 * Financial outcomes are NEVER decided here: every spin still settles
 * against the authenticated wallet route in `original-wallet.mjs`
 * (`/app/api/casino/original/firejoker/rgsm`).
 */
import { Router } from 'express';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../web/public/casino-original/firejoker/provider-original/8.1.3-firejoker.292/', import.meta.url));

function loadJson(relative) {
  const file = path.join(ROOT, relative);
  if (!existsSync(file)) throw new Error(`Fire Joker launcher: missing ${relative}`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

const GAME_DIR = 'resources/games/videoslot/firejoker/';
const RESOURCE_BASE = '/app/casino-original/firejoker/provider-original/8.1.3-firejoker.292/';

// Preload once at boot so a bad install fails loudly, not in production.
const configDesktop = loadJson(GAME_DIR + 'config_desktop.json');
const gameDesktopBundle = loadJson(GAME_DIR + 'game_desktop_bundle.json');
const uiDesktopBundle = loadJson(GAME_DIR + 'ui_desktop_bundle.json');

/**
 * Build the `configuration/v2` payload ContainerLauncher expects.
 * Most fields mirror what Play'n GO returns: availableModules lists the JS
 * module files the launcher must fetch (skin, game, UI), while the runtime
 * fields (sessionId, identityToken, ...) are opaque strings.
 *
 * The critical field is `gameResourceRoot` / `resourceRoot`: it tells the
 * launcher where config_desktop.json and the resource folders live, relative
 * to the game URL. Our route exposes them under the same directory.
 */
function buildConfiguration({ basePath, sessionId, currency }) {
  const resourceRoot = basePath.endsWith('/') ? basePath : basePath + '/';
  return {
    // Opaque identifiers - the client passes them back to the RGS, but our
    // `original-wallet.mjs` authenticates the player with its own HttpOnly
    // casino cookie, so these values are informational only.
    sessionId,
    identityToken: sessionId,
    aamsSessionString: '',
    cId: '',
    externalId: '',
    serverTime: new Date().toISOString(),
    serverTimeDelta: 0,

    // Session / game metadata.
    currency,
    jurisdiction: 'AL',
    language: 'en_GB',
    gameId: 'firejoker',
    gameName: 'Fire Joker',
    productGroup: 2,
    channel: 'desktop',
    practice: 0,
    brand: 'png',
    helpUrl: 'gamehelp/4864/',

    // Resource paths. These are what actually drive the launcher.
    gameResourceRoot: resourceRoot + 'resources/games/videoslot/firejoker/',
    resourceRoot,
    baseURL: resourceRoot,

    // Formats the client may render.
    webp: true,
    jp2: false,
    avif: false,

    // UI flags.
    showPoweredBy: false,
    debugAlert: false,
    loaderMessage: 'Loading Fire Joker',
    loaderMinShowDuration: 200,

    // Module list. The launcher fetches each of these as `<resourceRoot><file>`
    // and then calls `startGame(config)`.
    availableModules: {
      // The main game bundle.
      firejoker: 'games/firejoker/firejoker_desktop.bundle.js',
    },

    // Integration error messages (parsed by the launcher with JSON.parse).
    integrationErrorCodes: JSON.stringify({}),

    // Misc fall-throughs.
    hasGuaranteedJackpot: false,
    jackpots: null,
    assets: {
      config: GAME_DIR + 'config_desktop.json',
      game: GAME_DIR + 'game_desktop_bundle.json',
      ui: GAME_DIR + 'ui_desktop_bundle.json',
    },
  };
}

function buildPrelaunchConfiguration() {
  return {
    Server: '/app/api/casino/original/firejoker/rgsm',
    Language: 'en_GB',
    ErrorMessages: JSON.stringify({
      NOCONNECTION: 'Could not connect to the game server.',
      NOLOGIN: 'Your session has expired.',
      NOMONEY: 'Insufficient balance.',
      NOGAME: 'Game is unavailable right now.',
      NOSESSION: 'Please sign in again.',
    }),
  };
}

/**
 * Mount under the same static prefix as the game:
 *   /app/casino-original/firejoker/provider-original/8.1.3-firejoker.292/configuration/...
 *
 * The launcher's `getLaunchParameters` takes the launch URL as `server`, and
 * `generateV2Url` appends `configuration/v2` to it. So the router's `req.baseUrl`
 * already contains the full game path; we only need to return the JSON.
 */
export function createFireJokerLauncherRouter() {
  const router = Router();

  // Play'n GO's `GamesService.getGameByGid` fetches `/games/getgamebygid/:gid`
  // to resolve GameId / GameName / Brand / Currency before the loader even
  // knows which bundle to fetch. Without this endpoint the launcher stalls at
  // "getGameByGid" and the canvas stays black.
  //
  // The response shape is the one Play'n GO's `Validation.invalidate` reads:
  //   { Gid, GameId, GameName, Practice, Language, ProductGroup,
  //     CoreWebUrl, ShowPoweredBy, ... }
  // Every field is informational: financial outcomes are settled by the
  // authenticated wallet route (`original-wallet.mjs`).
  const gameMeta = (gid, req) => ({
    Gid: gid,
    GameId: 'firejoker',
    GameName: 'Fire Joker',
    // ContainerLauncher 8.1.3 reads these lower-camel-case fields.
    gId: gid,
    gameId: 'firejoker',
    name: 'Fire Joker',
    ProductGroup: 2,
    Practice: 0,
    Language: 'en_GB',
    Channel: 'desktop',
    Currency: 'ALL',
    Brand: 'png',
    ContextId: '',
    ShowPoweredBy: false,
    CoreWebUrl: (req.protocol || 'http') + '://' + (req.get('host') || 'localhost')
      + (req.baseUrl ? req.baseUrl + '/' : RESOURCE_BASE),
    ResourceRoot: req.baseUrl ? req.baseUrl + '/' : RESOURCE_BASE,
    Country: 'AL',
    Region: 'AL',
    Jurisdiction: 'AL',
    // Fields the launcher forwards to the game bundle verbatim.
    ExternalId: '',
    Ticket: '',
    SessionId: 'wallet-session',
  });

  router.get('/games/getgamebygid/:gid', (req, res) => {
    res.json(gameMeta(String(req.params.gid || 'firejoker'), req));
  });

  router.get('/games/getgamebygameid/:gameId', (req, res) => {
    res.json(gameMeta('firejoker', req));
  });

  // Play'n GO's loader also checks the resolved game metadata before
  // constructing `configuration/v2`. Accept both spellings.
  router.get('/games/getgamebyid/:gameId', (req, res) => {
    res.json(gameMeta('firejoker', req));
  });

  router.get('/configuration/v2', (req, res) => {
    // `server` is the launch URL the container was started from. The client
    // sends the same base back; we use it to build absolute resource URLs so
    // that nested modules (skin, game) resolve correctly.
    const launchUrl = String(req.query.server || '');
    const basePath = launchUrl.includes('/configuration/')
      ? launchUrl.replace(/\/configuration\/.*$/, '/')
      : (req.baseUrl ? req.baseUrl + '/' : RESOURCE_BASE);
    const sessionId = String(req.query.sessionId || req.query.identityToken || 'local-wallet');
    const currency = String(req.query.currency || 'ALL');
    res.json(buildConfiguration({ basePath, sessionId, currency }));
  });

  router.get('/configuration/prelaunchconfiguration', (_req, res) => {
    res.json(buildPrelaunchConfiguration());
  });

  // The launcher also asks for `<server>configuration/preLaunchConfiguration` in
  // older builds; accept both spellings.
  router.get('/configuration/preLaunchConfiguration', (_req, res) => {
    res.json(buildPrelaunchConfiguration());
  });

  return router;
}
