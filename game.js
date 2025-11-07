const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  backgroundColor: '#000000',
  physics: { default: 'arcade', arcade: { gravity: { y: 0 }, debug: false } },
  scene: { preload, create, update }
};

const game = new Phaser.Game(config);

// === Globals ===
let player, cursors, spaceKey, enterKey, escKey, cheatPowerKey, cheatLevelKey, cheatLivesKey;
let bullets, enemyBullets, enemies, crawlers, pixels, hearts, stickies;
let ammoPacks, ammoClusters, floors, powerUps;
let ammoPackCooldownUntil = 0, ammoPacksDroppedThisLevel = 0;
let spawnedAirborne = 0, spawnedCrawlers = 0;
let allowPackThisLevel = false;
let shotsPressed = 0, enemiesKilled = 0;

let windActive = false, windStrength = 0, windUntil = 0, nextWindTime = 0;
let hazardActive = false, hazardUntil = 0, nextHazardTime = 0, hazardWarnUntil = 0;
let lastHazardDamageTime = 0;
let hazardSafeWindow = null;
let hazardSafeZoneSprite = null;
let comboCount = 0, comboMultiplier = 1, comboExpireAt = 0;
let overdriveMeter = 0, overdriveActive = false, overdriveUntil = 0;

let crawlerUidCounter = 1;
let score = 0, levelScore = 0;
let pixelMeter = 50;            // ammo only
let lives = 1;
let gameOver = false, paused = false;
let spawnTimer = 0, lastFired = 0;
let level = 1;
let enemiesToSpawn = 0;
let gameState = 'playing'; // 'playing' | 'levelComplete' | 'levelFailed' | 'gameover'
let scoreText, ammoText, livesText, scoreProgressBg, scoreProgressBar, overlayText, statsText, powerUpText, comboText, overdriveText;
let playerInvincible = false;
let glitchUnlimitedLives = false;
let levelWrapReadyAt = 0;
let upgradeAmmo = 0, upgradeCooling = 0, upgradePower = 0;
let upgradePending = false, upgradeMenuActive = false;
const PAUSE_BASE_TEXT = 'PAUSED\nESC: RESUME   SPACE: RESTART';

// inter-level stats
let shotsFired = 0, shotsHit = 0;

// anti-air-abuse (single jump + coyote time)
let lastGroundedAt = 0;
const COYOTE_MS = 120;
let airJumpCharges = 0;
let enemyUidCounter = 1;
let powerUpQuotaThisLevel = 0;
let powerUpsGrantedThisLevel = 0;

// shooting economy / heat
const MAX_ACTIVE_BULLETS = 30;
const PELLETS_PER_SHOT = 10;     // requested
const SHOT_COOLDOWN_MS = 520;
let heat = 0;                    // 0..100
let overheated = false;

// constants
const PIXEL_PICKUP_VALUE = 1;    // value of each tiny ammo (used by clusters too)
const AMMO_PACK_VALUE = 40;
const JUMP_VELOCITY = -240;
const POWER_UP_DURATION = 10000;
const tune = {
  ammoBase: 100,
  ammoStep: 20,
  refillStep: 20,
  heatFloor: 0.55,
  heatStep: 0.12,
  coolStep: 0.18,
  comboBase: 2400,
  comboStep: 260,
  comboCap: 2200,
  overdriveFill: 7,
  overdriveFillScale: 1.5,
  overdriveScore: 1.5
};
const POWER_UP_TYPES = [
  { key: 'immunity',    label: 'IMMUNITY',     short: 'IMM', color: 0xff66ff },
  { key: 'machineGun',  label: 'MACHINE GUN',  short: 'MG',  color: 0xffd500 },
  { key: 'laser',       label: 'LASER',        short: 'LAS', color: 0x66ffff },
  { key: 'doubleJump',  label: 'DOUBLE JUMP',  short: 'DJ',  color: 0x88ff66 },
  { key: 'magnet',      label: 'MAGNET',       short: 'MAG', color: 0xff8844 },
  { key: 'doubleAmmo',  label: 'DOUBLE AMMO',  short: 'DA',  color: 0xffff66 },
  { key: 'doublePoints',label: 'DOUBLE PTS',   short: 'DP',  color: 0xff44aa }
];
const powerUpTimers = {};
const powerUpStacks = {};

function ammoPackDropChance(lv){ return lv <= 3 ? 0.18 : 0.22; }
function heartDropChance(lv){ return lv <= 3 ? 0.07 : 0.1; }
function shooterChance(lv){
  if (lv === 4) return 0.35;
  if (lv === 5) return 0.45;
  if (lv === 6) return 0.55;
  return 0.6; // 7+
}
function maxAmmoPacksPerLevel(lv){ return 1; } // at most one per level
function shouldDropAmmoPack(scene){
  if (!allowPackThisLevel) return false;                     // ~50% of levels allow packs
  if (scene.time.now < ammoPackCooldownUntil) return false;  // cooldown gate
  if (ammoPacksDroppedThisLevel >= maxAmmoPacksPerLevel(level)) return false; // per-level cap
  if (pixelMeter >= 60) return false;                        // allow when genuinely getting low
  let chance = ammoPackDropChance(level);
  // If halfway through airborne spawns and still no pack, escalate chance
  const plannedAir = plannedAirborneForLevel(level);
  if (spawnedAirborne >= Math.floor(plannedAir/2) && ammoPacksDroppedThisLevel === 0) chance *= 2;
  return Math.random() < chance;
}

// moving floor becomes segmented later
// === Level setup ===
const levelConfig = [
  { enemies: 15, scoreTarget: 80   }, // need 8/15 kills
  { enemies: 20, scoreTarget: 140  }, // 14/20
  { enemies: 25, scoreTarget: 180  }, // 18/25
  { enemies: 30, scoreTarget: 220  }, // 22/30
  { enemies: 40, scoreTarget: 280  }, // 28/40
  { enemies: 45, scoreTarget: 320  }, // 32/45
  { enemies: 50, scoreTarget: 360  }  // 36/50
];

// 1/2/3-shot airborne enemies; crawlers are separate
const enemyTypes = [
  { key: 'enemy1', health: 1, size: { x: 34, y: 18 } },
  { key: 'enemy2', health: 2, size: { x: 38, y: 20 } },
  { key: 'enemy3', health: 3, size: { x: 42, y: 22 } }
];

// === Pixel art patterns ===
const cowboyPattern = [ // monkey hero (uses '8' and '5')
  '  88  88  ',
  ' 88888888 ',
  '88 8888 88',
  '8888888888',
  '88 5555 88',
  ' 88555588 ',
  '  885588  ',
  '  88  88  ',
  ' 8      8 '
];
const crawlerPattern = [
  '0 44440 0',
  ' 4444444 ',
  '444444444',
  '4 4 4 4 4',
  '4 4 4 4 4',
  '  4   4  '
];

function drawHeart(g, px=2){
  const p = [
    ' 99 99 ',
    '9999999',
    '9999999',
    ' 99999 ',
    '  999  ',
    '   9   '
  ];
  for (let y=0;y<p.length;y++)
    for (let x=0;x<p[y].length;x++)
      if(p[y][x]!==' ') g.fillStyle(0xff3366,1).fillRect(x*px,y*px,px,px);
}
function drawSticky(g,w=60,h=10){ g.fillStyle(0x6633aa,1).fillRect(0,0,w,h); }

// Procedurally draw a curved banana using arcs
function genBananaTex(scene, key, r, th, start, end, fill, outline, stem){
  // Draw a *filled crescent*: outer arc + inner arc (reversed), then stroke edges
  const g = scene.add.graphics();
  const cx = r + th + 3, cy = r + th + 3;
  const ro = r + th * 0.5;              // outer radius
  const ri = Math.max(2, r - th * 0.5); // inner radius

  // Fill crescent
  g.fillStyle(fill, 1);
  g.beginPath();
  g.moveTo(cx + ro * Math.cos(start), cy + ro * Math.sin(start));
  g.arc(cx, cy, ro, start, end, false);
  g.lineTo(cx + ri * Math.cos(end), cy + ri * Math.sin(end));
  g.arc(cx, cy, ri, end, start, true);
  g.closePath();
  g.fillPath();

  // Stroke outer & inner edges for definition
  g.lineStyle(2, outline, 1);
  g.beginPath(); g.arc(cx, cy, ro, start, end, false); g.strokePath();
  g.beginPath(); g.arc(cx, cy, ri, start, end, false); g.strokePath();

  // Tiny green stem at the start tip
  const sx = cx + ro * Math.cos(start), sy = cy + ro * Math.sin(start);
  g.fillStyle(stem, 1).fillRect(sx - 2, sy - 2, 4, 4);

  const size = (r + th + 8) * 2;
  g.generateTexture(key, size, size);
  g.destroy();
}

// === Utility ===
function drawPattern(g, pattern, px, colorMap) {
  for (let y = 0; y < pattern.length; y++)
    for (let x = 0; x < pattern[y].length; x++)
      if (pattern[y][x] !== ' ')
        g.fillStyle(colorMap[pattern[y][x]], 1).fillRect(x * px, y * px, px, px);
}
function getAmmoCap(){ return tune.ammoBase + upgradeAmmo * tune.ammoStep; }
function addPixels(v)  { pixelMeter = Math.min(getAmmoCap(), Math.max(0, pixelMeter + v)); }
function spendPixels(v){ pixelMeter = Math.max(0, pixelMeter - v); }
function hasLevelCfg() { return level >= 1 && level <= levelConfig.length; }
function getLevelCfg() { return hasLevelCfg() ? levelConfig[level - 1] : null; }
function getDifficultyScale(lv){
  if (lv <= levelConfig.length) return 1;
  const extra = lv - levelConfig.length;
  return 1 + extra * 0.15;
}
function accuracyPct(){ return shotsPressed ? Math.round((enemiesKilled / shotsPressed)*100) : 0; }
function isPowerUpActive(key, now){
  if (now === undefined && typeof game !== 'undefined' && game && game.loop) now = game.loop.now;
  const expiry = powerUpTimers[key] || 0;
  return expiry > (now || 0);
}
function getPowerUpDef(key){
  for (let i = 0; i < POWER_UP_TYPES.length; i++) if (POWER_UP_TYPES[i].key === key) return POWER_UP_TYPES[i];
  return null;
}
function decidePowerUpQuota(lv){
  const opts = [0, 1, 2];
  let weights;
  if (lv <= 2) weights = [0.75, 0.25, 0];
  else if (lv <= 4) weights = [0.4, 0.45, 0.15];
  else if (lv <= 6) weights = [0.25, 0.45, 0.30];
  else weights = [0.15, 0.4, 0.45];
  let roll = Math.random();
  for (let i = 0; i < opts.length; i++) {
    const w = weights[i] || 0;
    if (roll < w) return opts[i];
    roll -= w;
  }
  return 0;
}
function powerUpDropChanceForLevel(lv){
  if (lv <= 2) return 0.09;
  if (lv <= 4) return 0.12;
  if (lv <= 6) return 0.16;
  return 0.2;
}

function requiredKillRatio(lv){
  // Easier early, ramps to 75%
  if (lv <= 2) return 0.55;
  if (lv <= 4) return 0.60;
  if (lv <= 6) return 0.70;
  return 0.75;
}
function minCrawlersForLevel(lv){
  if (lv < 2) return 0;
  if (lv === 2) return 1;
  if (lv <= 4) return 2;
  if (lv <= 6) return 3;
  return 4;
}
function plannedAirborneForLevel(lv){
  const baseCfg = getLevelCfg() || levelConfig[levelConfig.length - 1];
  const total = Math.max(10, Math.round(baseCfg.enemies * getDifficultyScale(lv)));
  const minC = minCrawlersForLevel(lv);
  return Math.max(0, total - minC);
}
function getDynamicScoreTarget(){
  // Target based on AIRBORNE enemies only (crawlers don't give score).
  // Use the larger of planned airborne vs actual spawned airborne to avoid trivial early wins.
  const ratio = requiredKillRatio(level);
  const plannedAir = plannedAirborneForLevel(level);
  const effectiveAir = Math.max(plannedAir, spawnedAirborne);
  return Math.max(10, Math.round(effectiveAir * 10 * ratio));
}

function preload() {}

function initializeSessionState(){
  score = 0; levelScore = 0; pixelMeter = 100; lives = 1; level = 1;
  gameOver = false; paused = false; spawnTimer = 0; lastFired = 0;
  enemiesToSpawn = 0; gameState = 'playing'; playerInvincible = false;
  lastGroundedAt = 0; heat = 0; overheated = false;
  shotsFired = 0; shotsHit = 0;
  shotsPressed = 0; enemiesKilled = 0;
  spawnedAirborne = 0; spawnedCrawlers = 0;
  ammoPacksDroppedThisLevel = 0; ammoPackCooldownUntil = 0;
  allowPackThisLevel = false;
  airJumpCharges = 0;
  windActive = false; windStrength = 0; windUntil = 0;
  nextWindTime = 0; hazardActive = false; hazardUntil = 0; hazardWarnUntil = 0;
  nextHazardTime = 0; lastHazardDamageTime = 0;
  hazardSafeWindow = null;
  if (hazardSafeZoneSprite) { hazardSafeZoneSprite.destroy(); hazardSafeZoneSprite = null; }
  for (const k in powerUpTimers) delete powerUpTimers[k];
  for (const k in powerUpStacks) delete powerUpStacks[k];
  comboCount = 0; comboMultiplier = 1; comboExpireAt = 0;
  overdriveMeter = 0; overdriveActive = false; overdriveUntil = 0;
  glitchUnlimitedLives = false;
  levelWrapReadyAt = 0;
  upgradeAmmo = 0; upgradeCooling = 0; upgradePower = 0;
  upgradePending = false; upgradeMenuActive = false;
}

function createProceduralTextures(scene){
  const gP = scene.add.graphics();
  drawPattern(gP, cowboyPattern, 3, { '8': 0x6b4e16, '5': 0xffd19b });
  gP.generateTexture('player', 10*3, 9*3); gP.destroy();

  genBananaTex(scene, 'enemy1', 14, 7, 2.8, 5.1, 0xffe066, 0x9a8700, 0x4caf50);
  genBananaTex(scene, 'enemy2', 16, 8, 2.8, 5.1, 0xffd24d, 0x9a8700, 0x4caf50);
  genBananaTex(scene, 'enemy3', 18, 9, 2.8, 5.1, 0xffc233, 0x9a8700, 0x4caf50);

  const gC = scene.add.graphics();
  drawPattern(gC, crawlerPattern, 2, { '4': 0x7a4a00, '0': 0x3a2200 });
  gC.generateTexture('crawler', 9*2, 6*2); gC.destroy();

  const gB = scene.add.graphics(); gB.fillStyle(0xff0000,1).fillRect(0,0,4,4);
  gB.generateTexture('bullet',4,4); gB.destroy();

  const gEB = scene.add.graphics(); gEB.fillStyle(0x00e5ff,1).fillRect(0,0,4,6);
  gEB.generateTexture('ebullet',4,6); gEB.destroy();

  const gX = scene.add.graphics(); gX.fillStyle(0xffff00,1).fillRect(0,0,6,6);
  gX.generateTexture('pixel',6,6); gX.destroy();

  const gH = scene.add.graphics(); drawHeart(gH,2); gH.generateTexture('heart',14,12); gH.destroy();
  const gS = scene.add.graphics(); drawSticky(gS,60,10); gS.generateTexture('sticky',60,10); gS.destroy();

  const gAC = scene.add.graphics();
  gAC.fillStyle(0xffff66,1).fillRect(0,0,12,12);
  gAC.lineStyle(2,0x9a8700,1).strokeRect(1,1,10,10);
  gAC.generateTexture('ammoCluster',12,12);
  gAC.destroy();

  const gShield = scene.add.graphics();
  gShield.lineStyle(2, 0x66d9ff, 0.85);
  gShield.strokeCircle(20, 20, 18);
  gShield.fillStyle(0x66d9ff, 0.18);
  gShield.fillCircle(20, 20, 18);
  gShield.generateTexture('shieldAura', 40, 40);
  gShield.destroy();

  const gAP = scene.add.graphics();
  gAP.fillStyle(0xffcc33,1).fillRect(0,0,16,16);
  gAP.lineStyle(2,0xffffff,1).strokeRect(0,0,16,16);
  gAP.generateTexture('ammoPack',16,16);
  gAP.destroy();

  const gL = scene.add.graphics();
  gL.fillStyle(0x66ffff,1).fillRect(0,0,6,28);
  gL.generateTexture('laser',6,28);
  gL.destroy();

  POWER_UP_TYPES.forEach(def => {
    const gPU = scene.add.graphics();
    gPU.fillStyle(def.color,1).fillRect(0,0,22,22);
    gPU.lineStyle(2,0xffffff,1).strokeRect(0,0,22,22);
    gPU.fillStyle(0x111111,1).fillRect(6,10,10,2);
    gPU.generateTexture('power_'+def.key,22,22);
    gPU.destroy();
  });
}

function createPlayerSprite(scene){
  player = scene.physics.add.sprite(400, 520, 'player').setCollideWorldBounds(true);
  player.body.setGravityY(300);
  player.setData('slowedUntil', 0);
  player.setDepth(5);
}

function configureInput(scene){
  cursors = scene.input.keyboard.createCursorKeys();
  spaceKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
  enterKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
  escKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
  cheatPowerKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.C);
  cheatLevelKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.L);
  cheatLivesKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.U);
}

function createPhysicsGroups(scene){
  bullets      = scene.physics.add.group({ defaultKey: 'bullet', maxSize: 140 });
  enemyBullets = scene.physics.add.group({ defaultKey: 'ebullet', maxSize: 80 });
  enemies      = scene.physics.add.group();
  crawlers     = scene.physics.add.group({ allowGravity: false });
  pixels       = scene.physics.add.group();
  hearts       = scene.physics.add.group();
  stickies     = scene.physics.add.staticGroup();
  floors       = scene.physics.add.staticGroup();
  ammoPacks    = scene.physics.add.group();
  ammoClusters = scene.physics.add.group();
  powerUps     = scene.physics.add.group();
}

function createUI(scene){
  scoreText = scene.add.text(16, 12, 'Score: 0', { fontSize: '18px', fill: '#fff' }).setDepth(100);
  ammoText  = scene.add.text(16, 34, 'Ammo: 100', { fontSize: '18px', fill: '#ffff66' }).setDepth(100);
  livesText = scene.add.text(16, 56, 'Lives: 1', { fontSize: '18px', fill: '#ff8080' }).setDepth(100);
  powerUpText = scene.add.text(400, 54, '', { fontSize: '16px', fill: '#ffcc66', align: 'center' }).setOrigin(0.5,0).setDepth(100);
  powerUpText.setVisible(false);
  comboText = scene.add.text(400, 16, '', { fontSize: '16px', fill: '#ffa94d', align: 'center' }).setOrigin(0.5,0).setDepth(100);
  comboText.setVisible(false);
  overdriveText = scene.add.text(400, 32, '', { fontSize: '16px', fill: '#ff66aa', align: 'center' }).setOrigin(0.5,0).setDepth(100);
  overdriveText.setVisible(false);

  scoreProgressBg  = scene.add.graphics().fillStyle(0x555555, 1).fillRect(584, 16, 200, 16);
  scoreProgressBar = scene.add.graphics();

  overlayText = scene.add.text(400, 270, '', { fontSize: '30px', fill: '#00ffff', align: 'center' }).setOrigin(0.5).setDepth(101);
  statsText   = scene.add.text(400, 330, '', { fontSize: '18px', fill: '#ffffff', align: 'center' }).setOrigin(0.5).setDepth(101);
  overlayText.setVisible(false);
  statsText.setVisible(false);
}

function setupCollisions(scene){
  scene.physics.add.overlap(bullets, enemies, bulletHitEnemy, null, scene);
  scene.physics.add.overlap(bullets, crawlers, bulletHitCrawler, null, scene);
  scene.physics.add.overlap(player, pixels, playerHitPixel, null, scene);

  scene.physics.add.overlap(player, enemies, onPlayerDamagedByEnemy, null, scene);
  scene.physics.add.overlap(player, crawlers, playerHitCrawler, null, scene);

  scene.physics.add.overlap(player, enemyBullets, onPlayerDamagedByBullet, null, scene);
  scene.physics.add.overlap(player, hearts, collectHeart, null, scene);
  scene.physics.add.overlap(player, stickies, onStickyOverlap, null, scene);

  scene.physics.add.collider(player, floors, playerOnMovingFloor, null, scene);
  scene.physics.add.collider(hearts, floors, heartTouchesFloor, null, scene);

  scene.physics.add.collider(pixels, floors, ammoPelletTouchesFloor, null, scene);
  scene.physics.add.collider(enemyBullets, floors, destroyEnemyBullet, null, scene);
  scene.physics.add.collider(ammoClusters, floors, ammoClusterTouchesFloor, null, scene);
  scene.physics.add.collider(ammoPacks, floors, ammoPackTouchesFloor, null, scene);

  scene.physics.add.overlap(player, ammoClusters, playerHitAmmoCluster, null, scene);
  scene.physics.add.overlap(player, ammoPacks,    playerHitAmmoPack,    null, scene);
  scene.physics.add.collider(powerUps, floors, powerUpTouchesFloor, null, scene);
  scene.physics.add.overlap(player, powerUps, collectPowerUp, null, scene);
}

function create() {
  initializeSessionState();
  createProceduralTextures(this);
  createPlayerSprite(this);
  configureInput(this);
  createPhysicsGroups(this);
  createUI(this);
  setupCollisions(this);
  startLevel(this);
  updateComboIndicators(this, this.time.now);
}
function update(time, delta) {
  if (Phaser.Input.Keyboard.JustDown(escKey)) togglePause(this);
  if (paused) { if (Phaser.Input.Keyboard.JustDown(spaceKey)) restartGame(this); return; }

  if (gameOver) {
    if (Phaser.Input.Keyboard.JustDown(spaceKey) || Phaser.Input.Keyboard.JustDown(enterKey)) restartGame(this);
    return;
  }

  if (gameState === 'levelComplete') {
    if (upgradePending && (Phaser.Input.Keyboard.JustDown(enterKey) || Phaser.Input.Keyboard.JustDown(spaceKey))) openUpgradeMenu(this);
    else if (!upgradePending && (Phaser.Input.Keyboard.JustDown(enterKey) || Phaser.Input.Keyboard.JustDown(spaceKey))) {
      hideStats();
      gameState = 'playing';
      startLevel(this);
    }
  }
  if (gameState === 'upgrade') return;
  if (gameState === 'levelFailed') {
    if (Phaser.Input.Keyboard.JustDown(enterKey)) {
      restartGame(this);
    }
    return;
  }

  updateFloors(this, time, delta);
  updateFloatingCrawlers(this, time, delta);

  // Ground/coyote
  const onGround = player.body.blocked.down || player.body.touching.down || player.body.onFloor();
  if (onGround) lastGroundedAt = time;

  // Sticky check
  const nowMS = this.time.now;
  const stickyActive = nowMS < (player.getData('slowedUntil') || 0);
  const immunityActive = isPowerUpActive('immunity', nowMS);
  const machineGunActive = isPowerUpActive('machineGun', nowMS);
  const laserActive = isPowerUpActive('laser', nowMS);
  const magnetActive = isPowerUpActive('magnet', nowMS);
  const doubleJumpActive = isPowerUpActive('doubleJump', nowMS);
  pruneExpiredPowerUps(nowMS);
  const machineGunTier = machineGunActive ? getPowerUpTier('machineGun') : 0;
  const laserTier = laserActive ? getPowerUpTier('laser') : 0;
  const heatGain = Math.max(tune.heatFloor, 1 - upgradeCooling * tune.heatStep);
  const coolingBoost = 1 + upgradeCooling * tune.coolStep;

  if (cheatPowerKey && Phaser.Input.Keyboard.JustDown(cheatPowerKey)) openCheatPowerSelect(this);
  if (cheatLevelKey && Phaser.Input.Keyboard.JustDown(cheatLevelKey)) cheatJumpToLevel(this);
  if (cheatLivesKey && Phaser.Input.Keyboard.JustDown(cheatLivesKey)) toggleUnlimitedLivesGlitch(this);

  // Movement with sticky effect
  const baseSpeed = overdriveActive ? 380 : 300;
  const speed = stickyActive ? 80 : baseSpeed;
  if (stickyActive) { player.setDragX(1500); player.setMaxVelocity(160, 1000); }
  else { player.setDragX(0); player.setMaxVelocity(500, 2000); }
  if (!immunityActive) {
    if (stickyActive) player.setTint(0x66ccff); else player.clearTint();
  }

  if (cursors.left.isDown) player.setVelocityX(-speed);
  else if (cursors.right.isDown) player.setVelocityX(speed);
  else if (stickyActive) player.setVelocityX(player.body.velocity.x * 0.9);
  else player.setVelocityX(0);

  const doubleJumpTier = doubleJumpActive ? getPowerUpTier('doubleJump') : 0;
  const extraJumps = doubleJumpActive ? (doubleJumpTier >= 3 ? 2 : doubleJumpTier === 2 ? 1 : 0) : 0;
  if (onGround) {
    airJumpCharges = doubleJumpActive ? 1 + extraJumps : 0;
  } else if (!doubleJumpActive && airJumpCharges > 0) {
    airJumpCharges = 0;
  }

  // Single jump + coyote + optional air jump
  if (Phaser.Input.Keyboard.JustDown(cursors.up)) {
    const coyote = (onGround || time - lastGroundedAt <= COYOTE_MS);
    if (coyote) {
      player.setVelocityY(stickyActive ? JUMP_VELOCITY * 0.8 : JUMP_VELOCITY);
    } else if (airJumpCharges > 0) {
      airJumpCharges--;
      player.setVelocityY(JUMP_VELOCITY);
    }
  }

  if (!onGround && cursors.down.isDown) {
    const fastFallCap = overdriveActive ? 820 : 700;
    const boost = stickyActive ? 26 : 40;
    const vy = player.body.velocity.y || 0;
    player.setVelocityY(Math.min(fastFallCap, vy + boost));
  }

  // Shooting
  const autoFire = (machineGunActive || laserActive) && !spaceKey.isDown;
  if (gameState === 'playing' && time > lastFired && (spaceKey.isDown || autoFire)) {
    const activeBullets = bullets.countActive(true);
    let cooldown = SHOT_COOLDOWN_MS;
    if (machineGunActive) {
      const mgTempo = [0, 120, 95, 70];
      cooldown = mgTempo[Math.min(machineGunTier, mgTempo.length - 1)] || 120;
    } else if (laserActive) {
      const laserTempo = [0, 180, 150, 120];
      cooldown = laserTempo[Math.min(laserTier, laserTempo.length - 1)] || 180;
    } else if (overdriveActive) {
      cooldown = Math.max(220, SHOT_COOLDOWN_MS - comboMultiplier * 40);
    }
    const pelletsPerShot = laserActive ? 1 : (machineGunActive ? (machineGunTier >= 3 ? 2 : 1) : PELLETS_PER_SHOT);
    const hasAmmo = machineGunActive || laserActive || pixelMeter > 0;
    const overdriveDamageBonus = overdriveActive ? 1 + Math.floor(comboMultiplier / 2) : 0;
    const overdrivePierceBonus = overdriveActive ? Math.max(0, Math.floor(comboMultiplier / 3)) : 0;

    if (!overheated && hasAmmo && activeBullets < MAX_ACTIVE_BULLETS) {
      const canSpawn = Math.max(0, MAX_ACTIVE_BULLETS - activeBullets);
      let pellets = Math.min(pelletsPerShot, canSpawn);
      if (!machineGunActive) pellets = Math.min(pellets, pixelMeter);

      if (pellets > 0) {
        lastFired = time + cooldown;
        shotsPressed++;
        if (!machineGunActive && !laserActive) spendPixels(pellets);
        shotsFired += pellets;
        const fxFreq = laserActive ? 540 : machineGunActive ? 360 : 420;
        playFx(this, fxFreq, laserActive ? 0.22 : 0.08, laserActive ? 0.05 : 0.07);

        if (laserActive) {
          bullets.children.each(existing => {
            if (existing.active && existing.getData && existing.getData('beam')) {
              bullets.killAndHide(existing);
              if (existing.body) existing.body.enable = false;
            }
          });
        }

        for (let i = 0; i < pellets; i++) {
          const b = bullets.get(player.x, player.y - 20);
          if (!b) continue;
          b.setActive(true).setVisible(true).setDepth(4);
          if (b.body) b.body.enable = true;
          if (laserActive) {
            b.setTexture('laser');
            const beamHeight = Math.max(120, player.y);
            const half = beamHeight * 0.5;
            const beamWidth = 6 + laserTier * 2;
            b.setDisplaySize(beamWidth, beamHeight);
            if (b.body) {
              b.body.setSize(beamWidth, beamHeight, true);
              b.body.allowGravity = false;
              b.body.velocity.x = 0;
              b.body.velocity.y = 0;
            }
            b.x = player.x;
            b.y = player.y - half;
            b.setAngle(0);
            const laserDamage = 3 + Math.max(0, laserTier - 1) * 2 + overdriveDamageBonus + upgradePower;
            const laserPierce = 40 + (laserTier > 0 ? (laserTier * 18) : 0) + overdrivePierceBonus * 12;
            b.setData('damage', laserDamage);
            b.setData('pierce', laserPierce);
            b.setData('beam', true);
            const beamDuration = Math.max(120, cooldown) - 10;
            b.setData('beamUntil', time + beamDuration);
          } else {
            b.setTexture('bullet');
            b.setDisplaySize(4, 4);
            if (b.body) b.body.setSize(4, 4, true);
            const verticalKick = machineGunActive ? -560 - machineGunTier * 15 : -520 - overdriveDamageBonus * 12;
            b.body.velocity.y = verticalKick + Phaser.Math.Between(-40, 40);
            if (machineGunActive) {
              const spread = Math.max(6, 26 - machineGunTier * 6);
              b.body.velocity.x = Phaser.Math.Between(-spread, spread);
            } else {
              b.body.velocity.x = Phaser.Math.Between(-80, 80);
            }
            b.setAngle(0);
            const bonusDamage = (machineGunActive ? Math.max(0, machineGunTier - 1) : 0) + overdriveDamageBonus + upgradePower;
            const baseDamage = 1 + bonusDamage;
            const pierceBonus = (machineGunActive ? Math.max(0, machineGunTier - 1) : 0) + overdrivePierceBonus;
            b.setData('damage', baseDamage);
            b.setData('pierce', pierceBonus);
            b.setData('beam', false);
            b.setData('beamUntil', 0);
          }
          b.setData('lastHitId', 0);
        }

        if (!machineGunActive) {
          heat = Math.min(100, heat + 18 * heatGain * (pellets / PELLETS_PER_SHOT));
          if (heat >= 100) { overheated = true; showOverlay(this, 'OVERHEATED!', 600); }
        }
      }
    } else if (hasAmmo) {
      lastFired = time + cooldown;
    }
  }
  if (machineGunActive) { heat = Math.max(0, heat - (delta * 0.15 * coolingBoost)); overheated = false; }
  else {
    const coolRate = overdriveActive ? 0.08 : 0.05;
    heat = Math.max(0, heat - (delta * coolRate * coolingBoost));
  }
  if (overheated && heat <= 40) overheated = false;

  // UI texts
  ammoText.setText('Ammo: ' + pixelMeter);
  livesText.setText(glitchUnlimitedLives ? 'Lives: ∞' : 'Lives: ' + lives);
  scoreText.setText('Score: ' + score);

  // Score progress bar (dynamic target: stable per level, based on configured enemies)
  const dynTarget = getDynamicScoreTarget();
  const ratio = Phaser.Math.Clamp(dynTarget > 0 ? (levelScore / dynTarget) : 0, 0, 1);
  scoreProgressBar.clear();
  scoreProgressBar.fillStyle(0x00ff00, 1).fillRect(584, 16, ratio * 200, 16);

  // Spawning (mix airborne and crawlers)
  if (enemiesToSpawn > 0 && time > spawnTimer) {
    const spawnsLeft = enemiesToSpawn;
    const needCrawlers = Math.max(0, minCrawlersForLevel(level) - spawnedCrawlers);
    let doCrawler = false;

    // Guarantee the very first spawn on level >= 2 is a crawler so players see the mechanic
    if (level >= 2 && spawnedCrawlers === 0 && spawnedAirborne === 0) {
      doCrawler = true;
    } else if (needCrawlers > 0 && needCrawlers >= spawnsLeft) {
      // Owe crawlers and running out of spawns → force crawler
      doCrawler = true;
    } else if (level >= 3) {
      // Otherwise ~25% chance of crawler from level 3+
      doCrawler = (Math.random() < 0.25);
    } else if (level === 2) {
      // Level 2: ensure at least one crawler appears
      doCrawler = (spawnedCrawlers < minCrawlersForLevel(level));
    }

    if (doCrawler) spawnCrawler(this); else spawnAirEnemy(this, time);

    enemiesToSpawn--;
    spawnTimer = time + Math.max(260, 1500 - (level * 100));
  }

  // Shooter fliers fire on timers
  enemies.children.each(e => {
    if (!e.active || !e.canShoot) return;
    if (!e.nextShot) e.nextShot = time + Phaser.Math.Between(900, 2000);
    if (time > e.nextShot) {
      e.nextShot = time + Phaser.Math.Between(1200, 2400);
      enemyShoot(this, e);
    }
  });

  // Remove expired stickies
  stickies.children.each(s => { if (s.active && nowMS > (s.getData('expiresAt')||0)) s.destroy(); });
  // Expire floor ammo pellets and packs
  pixels.children.each(p => {
    if (!p.active) return;
    const exp = p.getData('expiresAt');
    if (exp && nowMS > exp) { pixels.killAndHide(p); if (p.body) p.body.enable = false; }
  });
  ammoPacks.children.each(pk => {
    if (!pk.active) return;
    const exp = pk.getData('expiresAt');
    if (exp && nowMS > exp) { ammoPacks.killAndHide(pk); if (pk.body) pk.body.enable = false; }
  });
  powerUps.children.each(pu => {
    if (!pu.active) return;
    const exp = pu.getData('expiresAt');
    if (exp && nowMS > exp) { powerUps.killAndHide(pu); if (pu.body) pu.body.enable = false; }
  });

  // Level end check
  const hostilesRemaining = enemies.countActive() + crawlers.countActive();
  maybeFinalizeLevel(this, nowMS, hostilesRemaining);

  // Lose condition
  if (lives <= 0 && !gameOver) {
    gameOver = true; gameState = 'gameover'; this.physics.pause();
    clearPowerUpsForTransition(this);
    showStats(this, 'GAME OVER', accuracyPct(), enemiesKilled, levelScore, 'ENTER/R: RESTART');
  }

  // Cleanup + beam upkeep
  bullets.children.each(b => {
    if (!b.active) return;
    if (b.getData && b.getData('beam')) {
      const until = b.getData('beamUntil') || 0;
      if (nowMS > until) {
        bullets.killAndHide(b);
        if (b.body) b.body.enable = false;
        return;
      }
      const beamHeight = Math.max(120, player ? player.y : 600);
      const half = beamHeight * 0.5;
      b.x = player.x;
      b.y = player.y - half;
      b.setDisplaySize(8, beamHeight);
      if (b.body) {
        b.body.setSize(8, beamHeight, true);
        b.body.allowGravity = false;
        b.body.velocity.x = 0;
        b.body.velocity.y = 0;
      }
      return;
    }
    if (b.y < -10 || b.x < -10 || b.x > 810) {
      bullets.killAndHide(b);
      if (b.body) b.body.enable = false;
    }
  });
  enemyBullets.children.each(b => { if (b.active && (b.y > 610 || b.x < -10 || b.x > 810)) b.setActive(false).setVisible(false); });
  pixels.children.each(p => {
    if (!p.active) return;
    if (p.getData && p.getData('stuck')) return;
    if (p.y > 610) p.setActive(false).setVisible(false);
  });
  enemies.children.each(e => { if (e.active && (e.x < -20 || e.x > 820 || e.y > 620)) e.setActive(false).setVisible(false); });
  crawlers.children.each(c => {
    if (!c.active) return;
    const entered = !!c.getData('entered');
    if ((entered && (c.x < -40 || c.x > 840)) || c.y > 620) {
      despawnCrawler(this, c);
    }
  });
  if (magnetActive) attractPickupsToPlayer(player); else releasePickupAcceleration();
  syncStuckGroup(pixels);
  syncStuckGroup(ammoPacks);
  syncStuckGroup(ammoClusters);
  updateEnemyAuras();
  scheduleEnvironmentalEvents(this, nowMS, delta);
  applyWindForces(delta);
  handleFloorHazardDamage(this, nowMS, onGround, immunityActive);

  if (comboCount > 1 && nowMS < comboExpireAt) updateComboIndicators(this, nowMS);
  if (comboCount > 0 && nowMS > comboExpireAt) {
    comboCount = 0; comboMultiplier = 1; updateComboIndicators(this, nowMS);
  }
  if (overdriveActive) {
    if (nowMS > overdriveUntil) {
      endOverdrive();
      updateComboIndicators(this, nowMS);
    } else {
      updateComboIndicators(this, nowMS);
    }
  } else if (overdriveMeter > 0) {
    overdriveMeter = Math.max(0, overdriveMeter - delta * 0.02);
    updateComboIndicators(this, nowMS);
  }

  if (!gameOver && gameState === 'playing' && !machineGunActive && !laserActive && pixelMeter <= 0) {
    const ammoDrops = totalAmmoPickups();
    const shotsInAir = bullets.countActive(true);
    if (ammoDrops === 0 && shotsInAir === 0) {
      outOfAmmoLose(this);
    }
  }

  const rainbowHue = ((nowMS / 80) % 360) / 360;
  if (immunityActive) {
    const tint = Phaser.Display.Color.HSVToRGB(rainbowHue, 0.95, 1);
    player.setTint(tint.color);
    player.setAlpha(1);
  } else {
    player.setAlpha(playerInvincible ? 0.5 : 1);
  }
  if (hazardSafeZoneSprite && hazardSafeWindow && hazardSafeWindow.segment && hazardSafeWindow.segment.active) {
    hazardSafeZoneSprite.x = hazardSafeWindow.segment.x;
    hazardSafeZoneSprite.y = hazardSafeWindow.segment.y;
  }
  updatePowerUpText(powerUpText, nowMS);
}

// === Game logic helpers ===
function startLevel(scene) {
  const baseCfg = getLevelCfg() || levelConfig[levelConfig.length - 1];
  const scale = getDifficultyScale(level);
  enemiesToSpawn = Math.max(10, Math.round(baseCfg.enemies * scale));
  levelScore = 0;
  shotsFired = 0; shotsHit = 0;
  shotsPressed = 0; enemiesKilled = 0;
  spawnedAirborne = 0; spawnedCrawlers = 0;
  heat = 0; overheated = false;
  pixelMeter = Math.min(getAmmoCap(), pixelMeter + upgradeAmmo * tune.refillStep);
  clearGroupsForNewLevel(scene);
  buildFloors(scene);
  ammoPacksDroppedThisLevel = 0;
  ammoPackCooldownUntil = 0;
  allowPackThisLevel = Math.random() < 0.5; // ~one pack every two levels on average
  powerUpQuotaThisLevel = decidePowerUpQuota(level);
  powerUpsGrantedThisLevel = 0;
  clearStuckMetadata();
  windActive = false; windStrength = 0; windUntil = 0; nextWindTime = 0;
  hazardActive = false; hazardUntil = 0; nextHazardTime = 0; hazardWarnUntil = 0;
  hazardSafeWindow = null;
  if (hazardSafeZoneSprite) { hazardSafeZoneSprite.destroy(); hazardSafeZoneSprite = null; }
  levelWrapReadyAt = 0;
  updateComboIndicators(scene, scene.time.now);
}

function clearGroupsForNewLevel(scene) {
  enemies.clear(true, true);
  crawlers.clear(true, true);
  pixels.clear(true, true);
  bullets.clear(true, true);
  enemyBullets.clear(true, true);
  hearts.clear(true, true);
  stickies.clear(true, true);
  floors && floors.clear(true, true);
  ammoPacks && ammoPacks.clear(true, true);
  ammoClusters && ammoClusters.clear(true, true);
  powerUps && powerUps.clear(true, true);
  if (hazardSafeZoneSprite) { hazardSafeZoneSprite.destroy(); hazardSafeZoneSprite = null; }
}

function endGameWin(scene, acc) {
  gameOver = true; gameState = 'gameover'; scene.physics.pause();
  clearPowerUpsForTransition(scene);
  showStats(scene, 'YOU WIN!', acc, enemiesKilled, levelScore, 'ENTER/R: RESTART');
}

function getFloorSegmentAt(scene, x){
  let best = null;
  let bestDist = Infinity;
  floors.children.each(seg => {
    if (!seg || !seg.active) return;
    const dist = Math.abs(seg.x - x);
    if (dist < bestDist) { bestDist = dist; best = seg; }
  });
  return best;
}

function spawnAirEnemy(scene, time) {
  const side = Phaser.Math.Between(0, 1);
  const x = side === 0 ? 0 : 800;
  const y = Phaser.Math.Between(50, 220);

  let eType;
  if (level < 3) eType = enemyTypes[0];
  else if (level < 5) eType = enemyTypes[Phaser.Math.Between(0, 1)];
  else eType = enemyTypes[Phaser.Math.Between(1, 2)];

  const e = enemies.create(x, y, eType.key);
  e.setData('uid', enemyUidCounter++);

  const s = Phaser.Math.FloatBetween(0.9, 1.3);
  e.setScale(s).setDepth(3);
  e.maxHealth = eType.health;
  e.health = eType.health;
  e.setAlpha(1);
  e.setSize(Math.round(eType.size.x * s), Math.round(eType.size.y * s));
  e.setData('shield', 0);
  e.setData('shieldMax', 0);
  e.setData('shieldSprite', null);

  const xSpeed = side === 0 ? Phaser.Math.Between(60, 160) : Phaser.Math.Between(-160, -60);
  const ySpeed = Phaser.Math.Between(10, 40);
  e.setVelocity(xSpeed, ySpeed);
  e.setAngle(Phaser.Math.Between(-12, 12));

  e.canShoot = false;
  if (level >= 4 && eType.health >= 2) e.canShoot = Math.random() < shooterChance(level);

  if (level >= 8) {
    const shieldChance = Phaser.Math.Clamp(0.12 + (level - 8) * 0.03, 0.12, 0.55);
    if (Math.random() < shieldChance) {
      const shieldValue = eType.health >= 3 ? 3 : 2;
      setEnemyShield(scene, e, shieldValue);
    }
  }

  if (level >= 9 && Math.random() < 0.18) {
    e.setData('stealthMode', true);
    e.setAlpha(0.2);
  } else {
    e.setData('stealthMode', false);
  }

  spawnedAirborne++;
}

function spawnCrawler(scene, opts){
  if (!scene || !crawlers) return null;
  const side = Phaser.Math.Between(0, 1);
  const cfg = opts || {};
  const generation = Phaser.Math.Clamp(cfg.generation || 0, 0, 3);
  const fromChild = !!cfg.child;
  const scaleMod = generation === 0 ? 1 : generation === 1 ? 0.85 : 0.7;
  const baseScale = Phaser.Math.FloatBetween(1.05, 1.22) * scaleMod;
  const startX = cfg.x !== undefined ? cfg.x : (side === 0 ? -40 : 840);
  const baseY = cfg.baseY !== undefined ? cfg.baseY : (cfg.y !== undefined ? cfg.y : 552);
  const startY = cfg.y !== undefined ? cfg.y : baseY;
  const crawler = crawlers.create(startX, startY, 'crawler');
  crawler.setScale(baseScale).setDepth(6);
  crawler.setSize(Math.round(22 * baseScale), Math.round(12 * baseScale)).setOffset(0, 6);
  crawler.setImmovable(false);
  if (crawler.body) {
    crawler.body.setAllowGravity(false);
    crawler.body.allowGravity = false;
    crawler.body.setMaxVelocity(260, 260);
    crawler.body.setDrag(0, 0);
    crawler.body.setBounce(0, 0);
    crawler.body.setCollideWorldBounds(false);
    crawler.body.onWorldBounds = false;
  }
  crawler.setData('crawlerId', crawlerUidCounter++);
  crawler.setAlpha(1);
  crawler.setAngle(0);

  const levelBoost = 1 + Math.min(level, 12) * 0.02;
  const baseSpeed = cfg.speed !== undefined ? cfg.speed : Phaser.Math.Between(50, 90) * levelBoost;
  const dir = cfg.direction !== undefined ? Math.sign(cfg.direction) || 1 : (side === 0 ? 1 : -1);
  const speed = Phaser.Math.Clamp(baseSpeed, 40, 180) * dir;
  crawler.setData('speedX', speed);
  crawler.setData('spawnDir', dir >= 0 ? 1 : -1);
  crawler.setData('entered', false);
  crawler.setData('baseY', baseY);
  crawler.setData('hoverAmp', cfg.hoverAmp !== undefined ? cfg.hoverAmp : Phaser.Math.FloatBetween(4, 9) * (1 + generation * 0.25));
  crawler.setData('hoverSpeed', cfg.hoverSpeed !== undefined ? cfg.hoverSpeed : Phaser.Math.FloatBetween(1.4, 2.2));
  crawler.setData('hoverPhase', cfg.hoverPhase !== undefined ? cfg.hoverPhase : Math.random() * Math.PI * 2);
  crawler.setData('_lastHoverY', startY);

  const maxHealth = cfg.health !== undefined ? cfg.health :
    (generation === 0 ? (level >= 8 ? 4 : 3) : generation === 1 ? 2 : 1);
  crawler.setData('health', maxHealth);
  crawler.setData('maxHealth', maxHealth);
  crawler.setData('generation', generation);
  crawler.setData('splitCount', cfg.splitCount !== undefined ? cfg.splitCount : (generation < 2 ? 2 : 0));

  if (crawler.body) {
    crawler.body.setVelocityX(speed);
    crawler.body.setVelocityY(0);
  }

  if (!fromChild) spawnedCrawlers++;
  return crawler;
}

function enemyShoot(scene, e){
  const b = enemyBullets.get(e.x, e.y+6); if (!b) return;
  b.setActive(true).setVisible(true).setDepth(3);
  if (b.body) b.body.enable = true; // ensure body is enabled when reusing
  const dx = player.x - e.x, dy = (player.y - e.y);
  const len = Math.max(1, Math.hypot(dx, dy));
  const spd = 200 + Phaser.Math.Between(-20,20);
  b.body.velocity.x = (dx/len) * spd;
  b.body.velocity.y = (dy/len) * spd;
}

function bulletHitCrawler(bullet, crawler){
  if (!bullet.active || !crawler.active) return;
  const scene = this;
  const cid = crawler.getData('crawlerId') || 0;
  if (bullet.getData('lastHitId') === cid) return;
  bullet.setData('lastHitId', cid);
  shotsHit++;

  const now = scene.time.now;
  const isBeam = !!bullet.getData('beam');
  if (!isBeam){
    let pierce = bullet.getData('pierce') || 0;
    if (pierce > 0) bullet.setData('pierce', pierce - 1);
    else { bullets.killAndHide(bullet); if (bullet.body) bullet.body.enable = false; }
  }

  damageCrawler(scene, crawler, bullet.getData('damage') || 1, now);
}

function bulletHitEnemy(bullet, enemy) {
  if (!bullet.active || !enemy.active) return;
  const scene = this;
  const now = scene.time.now;
  const enemyId = enemy.getData('uid') || 0;
  if (bullet.getData('lastHitId') === enemyId) return;
  bullet.setData('lastHitId', enemyId);

  const damage = bullet.getData('damage') || 1;
  let shield = enemy.getData('shield') || 0;
  if (shield > 0) {
    shield = Math.max(0, shield - damage);
    enemy.setData('shield', shield);
    updateEnemyShieldVisual(enemy);
    if (shield <= 0) clearEnemyShield(enemy);

    if (shield > 0 || !bullet.getData('beam')) {
      if (!bullet.getData('beam')) {
        let pierce = bullet.getData('pierce') || 0;
        if (pierce > 0) bullet.setData('pierce', pierce - 1);
        else { bullets.killAndHide(bullet); if (bullet.body) bullet.body.enable = false; }
      }
      return;
    }
  }

  shotsHit++;

  enemy.health -= damage;
  if (enemy.health > 0) {
    const a = 0.4 + 0.6 * (enemy.health / enemy.maxHealth);
    enemy.setAlpha(a);
  } else {
    enemies.killAndHide(enemy); if (enemy.body) enemy.body.enable = false;
    enemiesKilled++;
    clearEnemyShield(enemy);

    const baseScore = 10;
    const scoreBonus = Math.round(baseScore * getScoreMultiplier(now));
    score += scoreBonus; levelScore += scoreBonus;

    const ammoMultiplier = getDoubleAmmoMultiplier(now);
    const pelletValue = ammoMultiplier >= 3 ? 2 : 1;
    const pellets = 8 * ammoMultiplier;
    for (let i = 0; i < pellets; i++) {
      const ox = Phaser.Math.Between(-8, 8);
      const oy = Phaser.Math.Between(-4, 4);
      const p = pixels.create(enemy.x + ox, enemy.y + oy, 'pixel');
      p.setData('value', pelletValue);
      p.setData('stuck', false);
      p.setData('stickSeg', null);
      p.setData('stickOffsetY', 0);
      p.setDepth(2);
      p.setBounce(0.1);
      p.body.allowGravity = true;
      p.body.setGravityY(900);
      p.setVelocity(Phaser.Math.Between(-30, 30), Phaser.Math.Between(40, 120));
    }

    if (shouldDropAmmoPack(scene)) {
      const pack = ammoPacks.create(enemy.x, enemy.y, 'ammoPack');
      pack.setData('value', AMMO_PACK_VALUE * ammoMultiplier);
      pack.setData('stuck', false);
      pack.setData('stickSeg', null);
      pack.setData('stickOffsetY', 0);
      pack.setDepth(2);
      pack.setBounce(0.2);
      pack.body.allowGravity = true;
      pack.body.setGravityY(900);
      pack.setVelocity(Phaser.Math.Between(-40,40), Phaser.Math.Between(50,100));
      ammoPacksDroppedThisLevel += 1;
      ammoPackCooldownUntil = scene.time.now + Phaser.Math.Between(6000, 9000);
    }

    if (Math.random() < heartDropChance(level)) {
      const h = hearts.create(enemy.x, enemy.y, 'heart');
      h.setData('collected', false);
      h.setDepth(2);
      h.setBounce(0.2);
      h.body.allowGravity = true;
      h.body.setGravityY(900);
      h.setVelocity(Phaser.Math.Between(-40,40), Phaser.Math.Between(60,100));
    }

    maybeDropPowerUp(scene, enemy.x, enemy.y);
    registerKill(scene, now);
  }

  let pierce = bullet.getData('pierce') || 0;
  if (pierce > 0) {
    bullet.setData('pierce', pierce - 1);
    bullet.y -= 18;
  } else if (!bullet.getData('beam')) {
    bullets.killAndHide(bullet); if (bullet.body) bullet.body.enable = false;
  }
}

// Ammo cluster settles on floor: stop moving + no gravity (so it stays)
function ammoClusterTouchesFloor(cluster, seg){
  if (!cluster.active) return;
  cluster.body.allowGravity = false;
  cluster.setVelocity(0,0);
  cluster.setBounce(0);
  cluster.setData('stuck', true);
  if (cluster.setData) {
    cluster.setData('stickSeg', seg || null);
    cluster.setData('stickOffsetY', seg ? (cluster.y - seg.y) : 0);
  }
}

// Ammo pack settles on floor: stop moving + no gravity (so it stays)
function ammoPackTouchesFloor(pack, seg){
  if (!pack.active) return;
  pack.body.allowGravity = false;
  pack.setVelocity(0,0);
  pack.setBounce(0);
  pack.setData('stuck', true);
  if (pack.setData) {
    pack.setData('stickSeg', seg || null);
    pack.setData('stickOffsetY', seg ? (pack.y - seg.y) : 0);
  }
}

function powerUpTouchesFloor(power, seg){
  if (!power.active) return;
  power.body.allowGravity = false;
  power.setVelocity(0,0);
  power.setBounce(0);
}

// Single ammo pellet settles on floor
function ammoPelletTouchesFloor(pellet, seg){
  if (!pellet.active) return;
  pellet.body.allowGravity = false;
  pellet.setVelocity(0,0);
  pellet.setBounce(0);
  pellet.setData('expiresAt', pellet.scene.time.now + 6000); // 6s to collect
  pellet.setData('stuck', true);
  if (pellet.setData) {
    pellet.setData('stickSeg', seg || null);
    pellet.setData('stickOffsetY', seg ? (pellet.y - seg.y) : 0);
  }
}

// Player collects ammo cluster
function playerHitAmmoCluster(player, cluster){
  if (!cluster.active) return;
  const val = cluster.getData('value') || 4;
  ammoClusters.killAndHide(cluster); if (cluster.body) cluster.body.enable = false;
  addPixels(val);
}

// Ammo pack (40)
function playerHitAmmoPack(player, pack){
  if (!pack.active) return;
  const scene = pack.scene;
  ammoPacks.killAndHide(pack); if (pack.body) pack.body.enable = false;
  const val = pack.getData('value') || AMMO_PACK_VALUE;
  const cap = getAmmoCap();
  if (pixelMeter >= cap) addPixels(val);
  else pixelMeter = cap;
  showOverlay(scene, 'MAX AMMO', 500);
}

function playerOnMovingFloor(player, seg){
  if (!player || !seg || !player.body) return;
  const body = player.body;
  if (body.velocity.y < 0 && body.bottom > seg.y) return; // hitting underside, ignore
  const segTop = seg.y - ((seg.displayHeight || seg.height || 20) * 0.5);
  if (body.bottom > segTop + 2) return;
  const targetTop = segTop - body.height + 1;
  if (body.position.y > targetTop) {
    body.position.y = targetTop;
    player.y = body.position.y + body.height * 0.5;
  }
  if (body.velocity.y > 0) body.velocity.y = 0;
  body.blocked.down = true;
  body.touching.down = true;
}

function openUpgradeMenu(scene){
  if (upgradeMenuActive) return;
  upgradeMenuActive = true;
  upgradePending = false;
  gameState = 'upgrade';
  scene.physics.pause();
  statsText.setVisible(false);
  overlayText.setText('UPGRADES STACK\nA Ammo Cap +20\nS Cooling Boost\nD Power Boost\nSPACE Skip');
  overlayText.setVisible(true);
  const keyboard = scene.input && scene.input.keyboard;
  const handler = evt => {
    if (!upgradeMenuActive) return;
    const key = evt.key.toLowerCase();
    if (key === 'a' || key === 's' || key === 'd' || key === ' ') finalizeUpgradeSelection(scene, key);
  };
  if (keyboard) keyboard.on('keydown', handler);
}

function finalizeUpgradeSelection(scene, key){
  upgradeMenuActive = false;
  let message = 'Skip';
  const option = key === 'a' ? 1 : key === 's' ? 2 : key === 'd' ? 3 : 0;
  if (option === 1) {
    upgradeAmmo++;
    message = `Ammo Cap ${getAmmoCap()}`;
  } else if (option === 2) {
    upgradeCooling++;
    message = `Cooling Lv ${upgradeCooling}`;
  } else if (option === 3) {
    upgradePower++;
    message = `Power Lv ${upgradePower}`;
  }
  hideOverlay();
  if (statsText) statsText.setVisible(false);
  scene.physics.resume();
  gameState = 'playing';
  showOverlay(scene, message, 800);
  startLevel(scene);
}

function collectPowerUp(player, power){
  if (!power.active) return;
  const scene = power.scene;
  const type = power.getData('type');
  powerUps.killAndHide(power); if (power.body) power.body.enable = false;
  const tier = grantPowerUp(scene, type, POWER_UP_DURATION);
  const def = getPowerUpDef(type);
  if (def) {
    const suffix = tier > 1 ? ` TIER ${tier}` : '';
    showOverlay(scene, 'POWER-UP: ' + def.label + suffix, 800);
  }
}

function maybeDropPowerUp(scene, x, y){
  if (!powerUps) return;
  if (powerUpsGrantedThisLevel >= powerUpQuotaThisLevel) return;
  if (powerUps.countActive(true) >= 2) return;
  if (Math.random() > powerUpDropChanceForLevel(level)) return;
  const def = Phaser.Utils.Array.GetRandom(POWER_UP_TYPES);
  if (!def) return;
  const spr = powerUps.create(x, y, 'power_' + def.key);
  spr.setData('type', def.key);
  spr.setData('expiresAt', scene.time.now + 8000);
  spr.setDepth(2);
  spr.setBounce(0.25);
  spr.body.allowGravity = true;
  spr.body.setGravityY(900);
  spr.setVelocity(Phaser.Math.Between(-60, 60), Phaser.Math.Between(40, 140));
  powerUpsGrantedThisLevel += 1;
}

function playerHitPixel(player, pixel) {
  const val = pixel.getData('value') || PIXEL_PICKUP_VALUE;
  pixels.killAndHide(pixel); if (pixel.body) pixel.body.enable = false;
  addPixels(val);
}

function collectHeart(player, heart){
  if (!heart.active) return;
  if (heart.getData('collected')) return;
  heart.setData('collected', true);
  hearts.killAndHide(heart); if (heart.body) heart.body.enable = false;
  lives = Math.min(lives + 1, 5);
}

function onStickyOverlap(player, sticky){
  const until = this.time.now + 2000;
  const prev  = player.getData('slowedUntil') || 0;
  player.setData('slowedUntil', Math.max(prev, until));
}

function onPlayerDamagedByEnemy(player, foe) {
  if (playerInvincible || isPowerUpActive('immunity', this.time.now)) return;
  damageLife(this);
}
function playerHitCrawler(player, crawler) {
  const now = this.time.now;
  if (playerInvincible) return;
  if (isPowerUpActive('immunity', now)) {
    if (crawler && crawler.active) {
      damageCrawler(this, crawler, crawler.getData('health') || 1, now);
    }
    return;
  }
  damageLife(this);
  resetComboState(this);
}
function onPlayerDamagedByBullet(player, ebullet){
  if (playerInvincible || isPowerUpActive('immunity', this.time.now)) return;
  enemyBullets.killAndHide(ebullet); if (ebullet.body) ebullet.body.enable = false;
  damageLife(this);
}

function destroyEnemyBullet(bullet, seg){
  if (!bullet.active) return;
  enemyBullets.killAndHide(bullet); if (bullet.body) bullet.body.enable = false;
}

function despawnCrawler(scene, crawler){
  if (!crawler || !crawler.active) return;
  crawlers.killAndHide(crawler);
  if (crawler.body) crawler.body.enable = false;
  const now = scene && scene.time ? scene.time.now : 0;
  if (scene && scene.time) {
    const remaining = (enemies ? enemies.countActive() : 0) + (crawlers ? crawlers.countActive() : 0);
    maybeFinalizeLevel(scene, now, remaining);
  }
}

function damageLife(scene) {
  scene.cameras.main.shake(120, 0.01);
  resetComboState(scene);
  if (glitchUnlimitedLives) {
    playerInvincible = true; player.setAlpha(0.5);
    scene.time.addEvent({ delay: 800, callback: () => { playerInvincible = false; player.setAlpha(1); } });
    return;
  }
  lives -= 1;
  if (lives <= 0) return;
  playerInvincible = true; player.setAlpha(0.5);
  scene.time.addEvent({ delay: 1000, callback: () => { playerInvincible = false; player.setAlpha(1); } });
}

function damageCrawler(scene, crawler, damage, now){
  if (!crawler || !crawler.active) return;
  const health = crawler.getData('health') || 1;
  const maxHealth = crawler.getData('maxHealth') || health || 1;
  const remaining = health - damage;
  if (remaining > 0) {
    crawler.setData('health', remaining);
    const alpha = 0.45 + 0.55 * (remaining / maxHealth);
    crawler.setAlpha(alpha);
    return;
  }

  const generation = crawler.getData('generation') || 0;
  const splitCount = crawler.getData('splitCount') || 0;
  const childSpeedBase = Math.max(45, Math.abs(crawler.getData('speedX') || 70));
  const childY = crawler.y;

  crawlers.killAndHide(crawler);
  if (crawler.body) crawler.body.enable = false;

  enemiesKilled++;
  const reward = Math.round(14 * getScoreMultiplier(now));
  score += reward; levelScore += reward;
  registerKill(scene, now);

  if (splitCount > 0 && generation < 2) {
    for (let i = 0; i < splitCount; i++) {
      const dir = i === 0 ? -1 : 1;
      const parentBaseY = crawler.getData('baseY') || childY;
      const child = spawnCrawler(scene, {
        x: crawler.x + dir * Phaser.Math.Between(10, 18),
        y: parentBaseY + Phaser.Math.Between(-6, 6),
        baseY: parentBaseY + Phaser.Math.Between(-4, 4),
        direction: dir,
        speed: childSpeedBase * (0.78 + Math.random() * 0.3),
        generation: generation + 1,
        health: generation + 1 >= 2 ? 1 : 2,
        splitCount: generation + 1 >= 2 ? 0 : 1,
        hoverAmp: Phaser.Math.FloatBetween(3, 6),
        hoverPhase: Math.random() * Math.PI * 2,
        child: true
      });
      if (child && child.body) {
        child.setAlpha(1);
        const velocity = dir * Math.max(70, Math.min(220, childSpeedBase + Phaser.Math.Between(10, 40)));
        child.body.setVelocityX(velocity);
        child.body.setVelocityY(0);
        child.setData('entered', true);
      }
    }
  }
}

function outOfAmmoLose(scene){
  if (gameOver) return;
  lives = 0;
  gameOver = true;
  gameState = 'gameover';
  clearPowerUpsForTransition(scene);
  scene.physics.pause();
  showStats(scene, 'OUT OF AMMO', accuracyPct(), enemiesKilled, levelScore, 'ENTER/R: RESTART');
}

function buildFloors(scene){
  // remove any old pieces
  floors.clear(true, true);

  // early levels: single long bar (classic floor)
  if (level < 5) {
    const seg = scene.add.rectangle(400, 590, 800, 20, 0x3b3b3b);
    seg.setDepth(0);
    scene.physics.add.existing(seg, true);
    seg.setData('baseY', 590);
    seg.setData('amp', 0);
    seg.setData('phase', 0);
    seg.setData('hazardActive', false);
    seg.setData('hazardIndex', 0);
    seg.setData('lastY', seg.y);
    floors.add(seg);
    return;
  }

  // later levels: the floor "becomes platforms"
  const pieces = (level < 7) ? 3 : 4;
  const segW = 800 / pieces;

  for (let i = 0; i < pieces; i++) {
    const x = (segW * 0.5) + (i * segW);
    const seg = scene.add.rectangle(x, 570, segW, 20, 0x3b3b3b);
    seg.setDepth(0);
    scene.physics.add.existing(seg, true);

    // wave params
    seg.setData('baseY', 570);
    seg.setData('amp', 28);
    seg.setData('phase', i * Math.PI * 0.6);
    seg.setData('hazardActive', false);
    seg.setData('hazardIndex', i);
    seg.setData('lastY', seg.y);
    floors.add(seg);
  }
}

function updateFloors(scene, t, delta){
  const speed = 0.0025; // sine speed
  const dt = Math.max(16, delta || 16);
  floors.children.iterate(seg => {
    if (!seg || !seg.body) return;
    const baseY = seg.getData('baseY') || 580;
    const amp   = seg.getData('amp')   || 0;
    const ph    = seg.getData('phase') || 0;
    const prevY = seg.getData('lastY');
    const y = baseY - Math.sin(t * speed + ph) * amp;
    seg.y = y;
    seg.body.updateFromGameObject();
    if (prevY !== undefined) {
      const velY = (y - prevY) / Math.max(0.001, dt / 1000);
      if (seg.body.velocity) seg.body.velocity.y = velY;
    }
    seg.setData('lastY', y);
  });
}

function heartTouchesFloor(heart, seg){
  if (!heart.active) return;
  const scene = heart.scene;
  const x = heart.x;
  const y = (seg ? seg.y : 585) - 10;

  // make sticky rectangle (static) that expires
  const patch = scene.add.rectangle(x, y, 60, 12, 0x6633aa).setOrigin(0.5);
  patch.setDepth(1);
  scene.physics.add.existing(patch, true);
  patch.setData('expiresAt', scene.time.now + 2500);
  stickies.add(patch);

  hearts.killAndHide(heart); if (heart.body) heart.body.enable = false;
}

function formatOverlayMessage(msg, includeLevel = true){
  if (!msg) return includeLevel ? `LEVEL ${level}` : '';
  if (!includeLevel) return msg;
  return `LEVEL ${level}\n${msg}`;
}

function hideOverlay(){
  if (!overlayText) return;
  overlayText.setText('');
  overlayText.setVisible(false);
}

function refreshPauseOverlay(extraLine = ''){
  if (!overlayText) return;
  const msg = extraLine ? `${PAUSE_BASE_TEXT}\n${extraLine}` : PAUSE_BASE_TEXT;
  overlayText.setText(formatOverlayMessage(msg));
  overlayText.setVisible(true);
  if (statsText) statsText.setVisible(false);
}

function togglePause(scene) {
  paused = !paused;
  scene.physics.world.isPaused = paused;
  if (!overlayText) return;
  if (paused) refreshPauseOverlay();
  else hideOverlay();
  if (statsText) statsText.setVisible(false);
}

function showOverlay(scene, msg, autoHideMs = 0, includeLevel = true) {
  if (!overlayText) return;
  if (!msg) { hideOverlay(); return; }
  overlayText.setText(formatOverlayMessage(msg, includeLevel));
  overlayText.setVisible(true);
  if (statsText) statsText.setVisible(false);
  if (autoHideMs > 0) {
    scene.time.addEvent({ delay: autoHideMs, callback: () => hideOverlay() });
  }
}
function showStats(scene, title, acc, hits, lvlScore, footer){
  if (!overlayText || !statsText) return;
  overlayText.setText(formatOverlayMessage(title));
  statsText.setText(`Hits: ${hits}   Accuracy: ${acc}%   Level Score: ${lvlScore}\n${footer}`);
  overlayText.setVisible(true); statsText.setVisible(true);
}
function hideStats(){
  hideOverlay();
  if (statsText) statsText.setVisible(false);
}

function restartGame(scene) {
  resetGlobalFlags(scene);
  scene.scene.restart();
}

function resetGlobalFlags(scene){
  paused = false;
  gameOver = false;
  playerInvincible = false;
  overheated = false;
  heat = 0;
  resetComboState(scene || (player && player.scene) || null);
  overdriveActive = false;
  overdriveMeter = 0;
  overdriveUntil = 0;
  glitchUnlimitedLives = false;
  windActive = false;
  windStrength = 0;
  windUntil = 0;
  nextWindTime = 0;
  hazardActive = false;
  hazardUntil = 0;
  nextHazardTime = 0;
  hazardWarnUntil = 0;
  hazardSafeWindow = null;
  if (hazardSafeZoneSprite) { hazardSafeZoneSprite.destroy(); hazardSafeZoneSprite = null; }
  levelWrapReadyAt = 0;
  upgradePending = false;
  upgradeMenuActive = false;
  if (player) { player.setAlpha(1); player.clearTint(); }
  setFloorHazardState(scene || (player && player.scene) || null, false);
  for (const key in powerUpTimers) delete powerUpTimers[key];
  for (const key in powerUpStacks) delete powerUpStacks[key];
  const now = scene && scene.time ? scene.time.now : (game && game.loop ? game.loop.now : 0);
  updateComboIndicators(scene || null, now);
}

function clearPowerUpsForTransition(scene){
  for (const key in powerUpTimers) powerUpTimers[key] = 0;
  for (const key in powerUpStacks) powerUpStacks[key] = 0;
  airJumpCharges = 0;
  releasePickupAcceleration();
  if (powerUps) powerUps.clear(true, true);
  if (scene && scene.time) updatePowerUpText(powerUpText, scene.time.now);
  clearFloorHazard(scene || (player && player.scene) || null);
  hazardActive = false;
  hazardUntil = 0;
  nextHazardTime = 0;
  hazardWarnUntil = 0;
  levelWrapReadyAt = 0;
  resetComboState(scene);
  overdriveActive = false;
  overdriveMeter = 0;
  overdriveUntil = 0;
  if (scene && scene.time) updateComboIndicators(scene, scene.time.now);
  if (player) {
    player.clearTint();
    player.setAlpha(playerInvincible ? 0.5 : 1);
  }
}

function totalAmmoPickups(){
  const pellets = pixels ? pixels.countActive(true) : 0;
  const packs = ammoPacks ? ammoPacks.countActive(true) : 0;
  const clusters = ammoClusters ? ammoClusters.countActive(true) : 0;
  return pellets + packs + clusters;
}

function syncStuckGroup(group){
  if (!group) return;
  group.children.each(item => {
    if (!item.active) return;
    if (!item.getData || !item.getData('stuck')) return;
    const seg = item.getData('stickSeg');
    if (seg && seg.active) {
      const offY = item.getData('stickOffsetY') || 0;
      item.y = seg.y + offY;
      if (item.body) item.body.updateFromGameObject();
    }
  });
}

function clearStuckMetadata(){
  [pixels, ammoPacks, ammoClusters].forEach(group => {
    if (!group) return;
    group.children.each(item => {
      if (!item || !item.setData) return;
      item.setData('stuck', false);
      item.setData('stickSeg', null);
      item.setData('stickOffsetY', 0);
    });
  });
}

function updateFloatingCrawlers(scene, time, delta){
  if (!crawlers) return;
  const dt = Math.max(16, delta || 16);
  const dtSec = dt / 1000;
  crawlers.children.each(crawler => {
    if (!crawler || !crawler.active || !crawler.body) return;
    const body = crawler.body;
    const speed = crawler.getData('speedX') || 0;
    const baseY = crawler.getData('baseY') || 552;
    const amp = crawler.getData('hoverAmp') || 6;
    const hovSpeed = crawler.getData('hoverSpeed') || 1.6;
    const phase = crawler.getData('hoverPhase') || 0;
    const timeFactor = (time || 0) * 0.001 * hovSpeed + phase;
    const hoverY = baseY + Math.sin(timeFactor) * amp;
    const prevHoverY = crawler.getData('_lastHoverY') || hoverY;

    crawler.x += speed * dtSec;
    crawler.y = hoverY;
    crawler.setData('_lastHoverY', hoverY);

    body.reset(crawler.x, hoverY);
    body.setAllowGravity(false);
    body.setVelocity(speed, (hoverY - prevHoverY) / dtSec);

    if (!crawler.getData('entered') && crawler.x > -20 && crawler.x < 820) {
      crawler.setData('entered', true);
    }
    const dir = crawler.getData('spawnDir') || (speed >= 0 ? 1 : -1);
    if (crawler.getData('entered')) {
      if ((dir >= 0 && crawler.x > 860) || (dir < 0 && crawler.x < -60)) despawnCrawler(scene, crawler);
    }
  });
}

function setEnemyShield(scene, enemy, hp){
  if (!enemy || !scene) return;
  enemy.setData('shield', hp);
  enemy.setData('shieldMax', hp);
  enemy.setTint(0x66d9ff);
  let aura = enemy.getData('shieldSprite');
  if (!aura || !aura.active) {
    aura = scene.add.sprite(enemy.x, enemy.y, 'shieldAura').setDepth(enemy.depth - 1);
    aura.setBlendMode(Phaser.BlendModes.ADD);
    enemy.setData('shieldSprite', aura);
  }
  updateEnemyShieldVisual(enemy);
}

function updateEnemyShieldVisual(enemy){
  const shield = enemy.getData('shield') || 0;
  const max = enemy.getData('shieldMax') || shield || 1;
  const aura = enemy.getData('shieldSprite');
  if (!shield){
    clearEnemyShield(enemy);
    return;
  }
  if (aura && aura.active){
    aura.setAlpha(0.3 + (shield / max) * 0.4);
    const scaleBase = enemy.scaleX || 1;
    aura.setScale(scaleBase * (0.7 + (shield / max) * 0.25));
  }
}

function clearEnemyShield(enemy){
  if (!enemy) return;
  enemy.clearTint();
  enemy.setData('shield', 0);
  const aura = enemy.getData('shieldSprite');
  if (aura && aura.active) aura.destroy();
  enemy.setData('shieldSprite', null);
}

function updateEnemyAuras(){
  enemies.children.each(e => {
    const aura = e.getData('shieldSprite');
    if (aura && aura.active){
      if (!e.active){
        aura.destroy();
        e.setData('shieldSprite', null);
        return;
      }
      aura.setPosition(e.x, e.y);
    }
    if (e.getData('stealthMode')){
      const dist = player ? Phaser.Math.Distance.Between(player.x, player.y, e.x, e.y) : 9999;
      const visible = dist < 180 || e.getData('shield') > 0 || e.canShoot;
      e.setAlpha(visible ? 1 : 0.2);
    }
  });
}
function scheduleEnvironmentalEvents(scene, now, delta){
  if (gameState !== 'playing') return;
  if (level < 9) return;
  if (nextWindTime === 0) nextWindTime = now + Phaser.Math.Between(6000, 11000);
  if (nextHazardTime === 0) nextHazardTime = now + Phaser.Math.Between(10000, 16000);

  if (!windActive && now > nextWindTime){
    const duration = Phaser.Math.Between(2500, 4500) + level * 45;
    windActive = true;
    windStrength = Phaser.Math.Between(120, 200) * (Math.random() < 0.5 ? -1 : 1) * (1 + level * 0.05);
    windUntil = now + duration;
    nextWindTime = windUntil + Phaser.Math.Between(7000, 12000);
    showOverlay(scene, windStrength > 0 ? 'WIND GUST →' : 'WIND GUST ←', 600, false);
  } else if (windActive && now > windUntil){
    windActive = false;
    windStrength = 0;
  }

  if (level >= 10 && !hazardActive){
    if (now > nextHazardTime - 1700 && hazardWarnUntil < now){
      hazardWarnUntil = now + 1500;
      showOverlay(scene, 'FLOOR SURGE INCOMING!', 1200, false);
    }
    if (now > nextHazardTime){
      hazardActive = true;
      hazardUntil = now + Phaser.Math.Between(2600, 4000);
      nextHazardTime = hazardUntil + Phaser.Math.Between(9000, 15000);
      prepareFloorHazard(scene);
      showOverlay(scene, 'FLOOR CHARGED!', 800, false);
    }
  } else if (hazardActive && now > hazardUntil){
    hazardActive = false;
    clearFloorHazard(scene);
  }
}

function applyWindForces(delta){
  if (!windActive || windStrength === 0) return;
  const scale = Math.min(1.2, (delta / 16) * 0.5);
  const push = windStrength * scale;
  if (player && player.active && player.body){
    player.body.velocity.x = Phaser.Math.Clamp(player.body.velocity.x + push, -460, 460);
  }
  enemies.children.each(e => {
    if (!e.active || !e.body || e.body.allowGravity) return;
    pushEntity(e, push * (e.getData('shield') ? 0.45 : 0.6));
  });
  bullets.children.each(b => {
    if (!b.active || !b.body || b.getData('beam')) return;
    pushEntity(b, push * 0.32);
  });
}

function pushEntity(entity, force){
  if (!entity.body) return;
  entity.body.velocity.x = Phaser.Math.Clamp(entity.body.velocity.x + force, -500, 500);
}

function prepareFloorHazard(scene){
  hazardSafeWindow = null;
  if (hazardSafeZoneSprite) { hazardSafeZoneSprite.destroy(); hazardSafeZoneSprite = null; }
  if (!floors) { setFloorHazardState(scene, false); return; }
  const segs = [];
  floors.children.each(seg => {
    if (!seg) return;
    seg.setData('hazardActive', false);
    segs.push(seg);
  });
  if (segs.length === 0) { setFloorHazardState(scene, false); return; }
  if (segs.length === 1) {
    const seg = segs[0];
    seg.setData('hazardActive', true);
    const segWidth = seg.width || seg.displayWidth || 800;
    const safeWidth = Math.min(segWidth * 0.45, 260);
    const left = seg.x - safeWidth * 0.5;
    const right = seg.x + safeWidth * 0.5;
    hazardSafeWindow = { left, right, segment: seg };
    hazardSafeZoneSprite = scene.add.rectangle(seg.x, seg.y, safeWidth, (seg.height || 20) + 10, 0x32ff99, 0.25).setDepth(1);
  } else {
    const indices = [];
    for (let i = 0; i < segs.length; i++) indices.push(i);
    Phaser.Utils.Array.Shuffle(indices);
    const safeCount = Math.max(1, Math.round(segs.length / 3));
   const safeIndices = indices.slice(0, safeCount);
    segs.forEach((seg, idx) => {
      const hazardous = safeIndices.indexOf(idx) === -1;
      seg.setData('hazardActive', hazardous);
    });
  }
  setFloorHazardState(scene, true);
}

function clearFloorHazard(scene){
  hazardSafeWindow = null;
  if (hazardSafeZoneSprite) { hazardSafeZoneSprite.destroy(); hazardSafeZoneSprite = null; }
  if (!floors) { return; }
  floors.children.each(seg => {
    if (seg) seg.setData('hazardActive', false);
  });
  setFloorHazardState(scene, false);
}

function setFloorHazardState(scene, active){
  if (!floors) return;
  floors.children.each(seg => {
    if (!seg || !seg.setFillStyle) return;
    const charged = active && seg.getData('hazardActive');
    seg.setFillStyle(charged ? 0xff6622 : 0x3b3b3b);
  });
  if (!active && hazardSafeZoneSprite) {
    hazardSafeZoneSprite.destroy();
    hazardSafeZoneSprite = null;
  }
}

function handleFloorHazardDamage(scene, now, onGround, immunityActive){
  if (!hazardActive) return;
  if (!onGround || immunityActive) return;
  const seg = getFloorSegmentAt(scene, player.x);
  const safeMargin = 16;
  if (!seg || !seg.getData('hazardActive')) {
    if (hazardSafeWindow && player.x >= hazardSafeWindow.left - safeMargin && player.x <= hazardSafeWindow.right + safeMargin) return;
    if (!seg || !seg.getData('hazardActive')) return;
  }
  if (hazardSafeWindow && player.x >= hazardSafeWindow.left - safeMargin && player.x <= hazardSafeWindow.right + safeMargin) return;
  if (now - lastHazardDamageTime < 650) return;
  lastHazardDamageTime = now;
  if (!playerInvincible) damageLife(scene);
}

function maybeFinalizeLevel(scene, now, hostilesRemaining){
  if (gameState !== 'playing') { levelWrapReadyAt = 0; return; }
  if (enemiesToSpawn === 0 && hostilesRemaining === 0) {
    if (!levelWrapReadyAt) levelWrapReadyAt = now;
    if (levelWrapReadyAt && (now - levelWrapReadyAt) > 260) {
      levelWrapReadyAt = 0;
      if (enemyBullets) enemyBullets.clear(true, true);
      const acc = accuracyPct();
      const dynTarget = getDynamicScoreTarget();
      if (levelScore >= dynTarget) {
        gameState = 'levelComplete';
        clearPowerUpsForTransition(scene);
        upgradePending = true;
        showStats(scene, `LEVEL ${level} CLEAR`, acc, enemiesKilled, levelScore, 'ENTER');
        level++;
      } else {
        gameState = 'levelFailed';
        clearPowerUpsForTransition(scene);
        showStats(scene, `LEVEL ${level} FAILED`, acc, enemiesKilled, levelScore, 'ENTER: RESTART RUN');
        scene.physics.pause();
      }
    }
  } else {
    levelWrapReadyAt = 0;
  }
}

function getPowerUpTier(type){ return powerUpStacks[type] || 0; }

function pruneExpiredPowerUps(now){
  for (const key in powerUpTimers){
    if (powerUpTimers[key] <= now){
      delete powerUpTimers[key];
      powerUpStacks[key] = 0;
    }
  }
}

function registerKill(scene, now){
  comboCount += 1;
  comboMultiplier = Math.min(6, 1 + Math.floor(comboCount / 6));
  const bonusWindow = Math.min(tune.comboCap, comboMultiplier * tune.comboStep);
  comboExpireAt = now + tune.comboBase + bonusWindow;
  const fill = tune.overdriveFill + comboMultiplier * tune.overdriveFillScale;
  overdriveMeter = Math.min(120, overdriveMeter + fill);
  if (overdriveActive) {
    overdriveUntil = Math.min(overdriveUntil + 450, now + 9000);
  } else if (overdriveMeter >= 100) {
    triggerOverdrive(scene, now);
  }
  updateComboIndicators(scene, now);
  const remaining = (enemies ? enemies.countActive() : 0) + (crawlers ? crawlers.countActive() : 0);
  maybeFinalizeLevel(scene, now, remaining);
}

function updateComboIndicators(scene, now){
  if (!comboText || !overdriveText) return;
  if (comboCount > 1){
    comboText.setVisible(true);
    const secs = Math.max(0, Math.ceil((comboExpireAt - now) / 1000));
    comboText.setText(`Combo x${comboMultiplier} (${comboCount})  ${secs}s`);
  } else {
    comboText.setVisible(false);
  }
  if (overdriveActive){
    const secs = Math.max(0, Math.ceil((overdriveUntil - now)/1000));
    overdriveText.setVisible(true);
    overdriveText.setText(`OVERDRIVE ${secs}s`);
  } else if (overdriveMeter > 0){
    overdriveText.setVisible(true);
    overdriveText.setText(`Overdrive ${Math.floor(overdriveMeter)}%`);
  } else overdriveText.setVisible(false);
}

function triggerOverdrive(scene, now){
  overdriveActive = true;
  overdriveUntil = now + 6000;
  overdriveMeter = 100;
  showOverlay(scene, 'OVERDRIVE!', 900);
  updateComboIndicators(scene, now);
}

function endOverdrive(){
  overdriveActive = false;
  overdriveMeter = 0;
}

function resetComboState(scene){
  comboCount = 0; comboMultiplier = 1; comboExpireAt = 0;
  overdriveMeter = Math.max(0, overdriveActive ? overdriveMeter : Math.floor(overdriveMeter * 0.6));
  const now = scene && scene.time ? scene.time.now : (game && game.loop ? game.loop.now : 0);
  updateComboIndicators(scene || null, now);
}

function getScoreMultiplier(now){
  let mult = 1;
  const dpTier = getPowerUpTier('doublePoints');
  if (isPowerUpActive('doublePoints', now)){
    mult *= dpTier >= 3 ? 4 : dpTier === 2 ? 3 : 2;
  }
  if (overdriveActive) mult *= tune.overdriveScore;
  mult *= 1 + (comboMultiplier - 1) * 0.18;
  return mult;
}

function getDoubleAmmoMultiplier(now){
  if (!isPowerUpActive('doubleAmmo', now)) return 1;
  const tier = getPowerUpTier('doubleAmmo');
  if (tier >= 3) return 4;
  if (tier === 2) return 3;
  return 2;
}

function grantPowerUp(scene, type, duration = POWER_UP_DURATION){
  const now = scene.time.now;
  const existing = powerUpTimers[type] || 0;
  const base = existing > now ? existing : now;
  const tier = Math.min((powerUpStacks[type] || 0) + 1, 3);
  powerUpStacks[type] = tier;
  const extended = duration * (1 + 0.3 * (tier - 1));
  powerUpTimers[type] = base + extended;

  if (type === 'doubleJump') {
    const extra = tier >= 3 ? 2 : tier === 2 ? 1 : 0;
    airJumpCharges = player.body.blocked.down ? 1 + extra : Math.max(airJumpCharges, 1 + extra);
  }
  if (type === 'machineGun') { heat = 0; overheated = false; }
  if (type === 'immunity') { playerInvincible = false; player.setAlpha(1); }

  updatePowerUpText(powerUpText, now);
  return tier;
}

function activateCheatAllPowerUps(scene){
  const longDuration = POWER_UP_DURATION * 1000;
  for (let i = 0; i < POWER_UP_TYPES.length; i++) {
    grantPowerUp(scene, POWER_UP_TYPES[i].key, longDuration);
  }
  showOverlay(scene, 'CHEAT ENABLED: ALL POWER UPS', 800);
}

function openCheatPowerSelect(scene){
  if (gameState === 'pause-cheat-power') return;
  const prevPause = paused;
  const prevGameState = gameState;
  const physicsWasPaused = scene.physics.world.isPaused;
  scene.physics.pause();
  paused = true;
  gameState = 'pause-cheat-power';

  const now = scene.time.now;
  const selected = new Set();
  for (let i = 0; i < POWER_UP_TYPES.length; i++) {
    if (isPowerUpActive(POWER_UP_TYPES[i].key, now)) selected.add(i);
  }

  const helper = scene.add.text(400, 300, '', {
    fontSize: '22px',
    fill: '#ffec99',
    align: 'center',
    backgroundColor: '#000000',
    padding: { x: 12, y: 12 }
  }).setOrigin(0.5).setDepth(200);

  const render = () => {
    const lines = [
      'CHEAT: POWER SELECT',
      '1-7 toggle, 0 clear, A all, ENTER apply, ESC cancel',
      ''
    ];
    for (let i = 0; i < POWER_UP_TYPES.length; i++) {
      const def = POWER_UP_TYPES[i];
      const marker = selected.has(i) ? '[X]' : '[ ]';
      lines.push(`${i + 1}. ${marker} ${def.label}`);
    }
    helper.setText(lines.join('\n'));
  };
  render();

  const finalize = applied => {
    scene.input.keyboard.off('keydown', keyHandler);
    helper.destroy();
    hideStats();
    if (!physicsWasPaused) scene.physics.resume();
    else scene.physics.pause();
    paused = prevPause;
    gameState = prevGameState;
    if (paused) {
      const extra = applied && applied !== '' ? applied : '';
      refreshPauseOverlay(extra);
      if (applied && applied !== '') {
        scene.time.addEvent({
          delay: 800,
          callback: () => { if (paused) refreshPauseOverlay(); }
        });
      }
    } else if (applied !== null) {
      showOverlay(scene, applied, 800);
    } else hideOverlay();
  };

  const applySelection = () => {
    const longDuration = POWER_UP_DURATION * 1000;
    const magnetIndex = POWER_UP_TYPES.findIndex(def => def.key === 'magnet');
    let appliedCount = 0;
    for (let i = 0; i < POWER_UP_TYPES.length; i++) {
      const def = POWER_UP_TYPES[i];
      if (selected.has(i)) {
        powerUpStacks[def.key] = 0;
        powerUpTimers[def.key] = 0;
        for (let tier = 0; tier < 3; tier++) grantPowerUp(scene, def.key, longDuration);
        appliedCount++;
      } else {
        powerUpTimers[def.key] = 0;
        powerUpStacks[def.key] = 0;
      }
    }
    if (magnetIndex >= 0 && !selected.has(magnetIndex)) releasePickupAcceleration();
    updatePowerUpText(powerUpText, scene.time.now);
    const msg = appliedCount > 0 ? `CHEAT: ${appliedCount} POWER UPS READY` : 'CHEAT CLEARED';
    finalize(msg);
  };

  const cancel = () => finalize('CHEAT CANCELLED');

  const keyHandler = evt => {
    if (evt.key >= '1' && evt.key <= String(POWER_UP_TYPES.length)) {
      const idx = parseInt(evt.key, 10) - 1;
      if (selected.has(idx)) selected.delete(idx); else selected.add(idx);
      render();
    } else if (evt.key === '0') {
      selected.clear();
      render();
    } else if (evt.key === 'a' || evt.key === 'A') {
      selected.clear();
      for (let i = 0; i < POWER_UP_TYPES.length; i++) selected.add(i);
      render();
    } else if (evt.key === 'Enter') {
      scene.input.keyboard.off('keydown', keyHandler);
      applySelection();
    } else if (evt.key === 'Escape') {
      scene.input.keyboard.off('keydown', keyHandler);
      cancel();
    }
  };

  scene.input.keyboard.on('keydown', keyHandler);
}

function toggleUnlimitedLivesGlitch(scene){
  glitchUnlimitedLives = !glitchUnlimitedLives;
  if (glitchUnlimitedLives) {
    lives = Math.max(lives, 3);
    showOverlay(scene, 'GLITCH ENABLED: ∞ LIVES', 900);
  } else {
    if (lives <= 0) lives = 1;
    showOverlay(scene, 'GLITCH DISABLED', 600);
  }
  if (livesText) livesText.setText(glitchUnlimitedLives ? 'Lives: ∞' : 'Lives: ' + lives);
}

function cheatJumpToLevel(scene){
  if (gameState === 'pause-cheat') return;
  const prevPause = paused;
  const prevGameState = gameState;
  const physicsWasPaused = scene.physics.world.isPaused;
  scene.physics.pause();
  paused = true;
  gameState = 'pause-cheat';

  const helper = scene.add.text(400, 300, '', {
    fontSize: '24px',
    fill: '#ffff66',
    align: 'center',
    backgroundColor: '#000000'
  }).setOrigin(0.5).setDepth(200);

  const baseMsg = `CHEAT LEVEL\nType any level >=1 and press ENTER\nESC to cancel`;
  let digits = '';
  const render = () => helper.setText(`${baseMsg}\n> ${digits}`);
  render();

  const finalize = targetLevel => {
    level = Math.max(1, targetLevel);
    clearPowerUpsForTransition(scene);
    pixelMeter = 100;
    lives = Math.max(lives, 1);
    resetGlobalFlags(scene);
    const resumeState = prevGameState === 'pause-cheat' ? 'playing' : prevGameState;
    paused = prevPause;
    gameState = resumeState || 'playing';
    startLevel(scene);
    if (player) {
      player.setPosition(400, 520);
      player.setVelocity(0, 0);
    }
    if (physicsWasPaused) scene.physics.pause(); else scene.physics.resume();
    const msg = `CHEAT: LEVEL ${level}`;
    if (paused) {
      refreshPauseOverlay(msg);
      scene.time.addEvent({
        delay: 800,
        callback: () => { if (paused) refreshPauseOverlay(); }
      });
    } else showOverlay(scene, msg, 800);
  };

  const cancel = msg => {
    if (physicsWasPaused) scene.physics.pause(); else scene.physics.resume();
    paused = prevPause;
    gameState = prevGameState;
    if (paused) {
      const extra = msg && msg !== '' ? msg : '';
      refreshPauseOverlay(extra);
      if (msg && msg !== '') {
        scene.time.addEvent({
          delay: 600,
          callback: () => { if (paused) refreshPauseOverlay(); }
        });
      }
    } else if (msg) {
      showOverlay(scene, msg, 600);
    } else hideOverlay();
  };

  const keyHandler = evt => {
    if (evt.key >= '0' && evt.key <= '9') {
      digits += evt.key;
      render();
    } else if (evt.key === 'Backspace') {
      digits = digits.slice(0, -1);
      render();
    } else if (evt.key === 'Enter') {
      const num = parseInt(digits, 10);
      scene.input.keyboard.off('keydown', keyHandler);
      helper.destroy();
      hideStats();
      if (!Number.isNaN(num)) finalize(num);
      else cancel('CHEAT CANCELLED');
    } else if (evt.key === 'Escape') {
      scene.input.keyboard.off('keydown', keyHandler);
      helper.destroy();
      hideStats();
      cancel('CHEAT CANCELLED');
    }
  };

  scene.input.keyboard.on('keydown', keyHandler);
}

function pullGroupToward(group, target, speed, lerp){
  if (!group) return;
  group.children.each(item => {
    if (!item.active || !item.body) return;
    if (item.getData && item.getData('stuck')) return;
    item.body.allowGravity = false;
    const dx = target.x - item.x;
    const dy = target.y - item.y;
    const dist = Math.max(6, Math.sqrt(dx*dx + dy*dy));
    const desiredX = (dx / dist) * speed;
    const desiredY = (dy / dist) * speed;
    item.body.velocity.x = Phaser.Math.Linear(item.body.velocity.x, desiredX, lerp);
    item.body.velocity.y = Phaser.Math.Linear(item.body.velocity.y, desiredY, lerp);
  });
}

function attractPickupsToPlayer(target){
  const tier = getPowerUpTier('magnet');
  const speedMult = 1 + tier * 0.35;
  const lerpBoost = tier * 0.05;
  pullGroupToward(pixels, target, 420 * speedMult, 0.35 + lerpBoost);
  pullGroupToward(ammoPacks, target, 360 * speedMult, 0.32 + lerpBoost);
  pullGroupToward(ammoClusters, target, 360 * speedMult, 0.32 + lerpBoost);
}

function releasePickupAcceleration(){
  restoreGroupPhysics(pixels);
  restoreGroupPhysics(ammoPacks);
  restoreGroupPhysics(ammoClusters);
}

function restoreGroupPhysics(group){
  if (!group) return;
  group.children.each(item => {
    if (!item.body) return;
    if (item.getData && item.getData('stuck')) return;
    if (!item.body.allowGravity) {
      item.body.allowGravity = true;
      item.body.setAcceleration(0, 0);
      item.body.velocity.x *= 0.6;
      item.body.velocity.y *= 0.6;
    }
  });
}

function playFx(scene, freq, d=0.12, v=0.07){
  if (!scene.sound || scene.sound.locked) return;
  const ctx = scene.sound.context;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'square';
  o.frequency.value = freq;
  g.gain.value = v;
  o.connect(g).connect(ctx.destination);
  const t = ctx.currentTime;
  g.gain.setValueAtTime(v, t);
  g.gain.linearRampToValueAtTime(0.0001, t + d);
  o.start(t);
  o.stop(t + d);
  o.onended = () => g.disconnect();
}

function updatePowerUpText(textObj, now){
  if (!textObj) return;
  const active = [];
  for (let i = 0; i < POWER_UP_TYPES.length; i++) {
    const def = POWER_UP_TYPES[i];
    const expiry = powerUpTimers[def.key] || 0;
    if (expiry > now) {
      const remaining = Math.max(0, Math.ceil((expiry - now) / 1000));
      const tier = getPowerUpTier(def.key);
      const label = tier > 1 ? `${def.short}${tier} ${remaining}s` : `${def.short} ${remaining}s`;
      active.push(label);
    }
  }
  if (active.length > 0) {
    textObj.setText(active.join('  '));
    textObj.setVisible(true);
  } else {
    textObj.setText('');
    textObj.setVisible(false);
  }
}
