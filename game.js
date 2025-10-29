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
let player, cursors, spaceKey, enterKey, pKey, rKey;
let bullets, enemyBullets, enemies, crawlers, pixels, hearts, stickies;
let ammoPacks, ammoClusters, floors;
let ammoPackCooldownUntil = 0, ammoPacksDroppedThisLevel = 0;
let spawnedAirborne = 0, spawnedCrawlers = 0;
let allowPackThisLevel = false;
let shotsPressed = 0, enemiesKilled = 0;

let score = 0, levelScore = 0;
let pixelMeter = 50;            // ammo only
let lives = 1;
let gameOver = false, paused = false;
let spawnTimer = 0, lastFired = 0;
let level = 1;
let enemiesToSpawn = 0;
let gameState = 'playing'; // 'playing' | 'levelComplete' | 'levelFailed' | 'gameover'
let scoreText, ammoText, livesText, scoreProgressBg, scoreProgressBar, overlayText, statsText;
let playerInvincible = false;

// inter-level stats
let shotsFired = 0, shotsHit = 0;

// anti-air-abuse (single jump + coyote time)
let lastGroundedAt = 0;
const COYOTE_MS = 120;

// shooting economy / heat
const MAX_ACTIVE_BULLETS = 30;
const PELLETS_PER_SHOT = 10;     // requested
const SHOT_COOLDOWN_MS = 520;
let heat = 0;                    // 0..100
let overheated = false;

// constants
const MAX_PIXELS = 100;
const PIXEL_PICKUP_VALUE = 1;    // value of each tiny ammo (used by clusters too)
const AMMO_PACK_VALUE = 40;
const JUMP_VELOCITY = -240;

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
let floorAmp = 0;

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
const enemyPattern1 = [ // 7 x 12
  '   02  ',
  '  022  ',
  ' 02220 ',
  ' 02220 ',
  ' 02220 ',
  '  0220 ',
  '   022 ',
  '   022 ',
  '   022 ',
  '  022  ',
  ' 022   ',
  ' 20    '
];
const enemyPattern2 = [ // 8 x 14
  '    033 ',
  '   0333 ',
  '  033330',
  '  033330',
  ' 0333330',
  ' 0333330',
  '  033330',
  '   03330',
  '    0330',
  '    0330',
  '   0330 ',
  '  0330  ',
  ' 0330   ',
  ' 30     '
];
const enemyPattern3 = [ // 9 x 16
  '     066 ',
  '    0666 ',
  '   066660',
  '   066660',
  '  0666660',
  '  0666660',
  '  0666660',
  '   066660',
  '    06660',
  '    06660',
  '    06660',
  '   06660 ',
  '  06660  ',
  ' 06660   ',
  ' 6660    ',
  '  60     '
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
function addPixels(v)  { pixelMeter = Math.max(0, pixelMeter + v); }
function spendPixels(v){ pixelMeter = Math.max(0, pixelMeter - v); }
function hasLevelCfg() { return level >= 1 && level <= levelConfig.length; }
function getLevelCfg() { return hasLevelCfg() ? levelConfig[level - 1] : null; }
function accuracyPct(){ return shotsPressed ? Math.round((enemiesKilled / shotsPressed)*100) : 0; }

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
  const cfg = getLevelCfg();
  const total = cfg ? cfg.enemies : 15;
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

function create() {
  // Reset state
  score = 0; levelScore = 0; pixelMeter = 100; lives = 1; level = 1;
  gameOver = false; paused = false; spawnTimer = 0; lastFired = 0;
  enemiesToSpawn = 0; gameState = 'playing'; playerInvincible = false;
  lastGroundedAt = 0; heat = 0; overheated = false;
  shotsFired = 0; shotsHit = 0;
  shotsPressed = 0; enemiesKilled = 0;
  spawnedAirborne = 0; spawnedCrawlers = 0;

  // Textures
  const gP = this.add.graphics(); drawPattern(gP, cowboyPattern, 3, { '8': 0x6b4e16, '5': 0xffd19b }); gP.generateTexture('player', 10*3, 9*3); gP.destroy();
  genBananaTex(this, 'enemy1', 14, 7, 2.8, 5.1, 0xffe066, 0x9a8700, 0x4caf50);
  genBananaTex(this, 'enemy2', 16, 8, 2.8, 5.1, 0xffd24d, 0x9a8700, 0x4caf50);
  genBananaTex(this, 'enemy3', 18, 9, 2.8, 5.1, 0xffc233, 0x9a8700, 0x4caf50);
  const gC = this.add.graphics(); drawPattern(gC, crawlerPattern, 2, { '4': 0x7a4a00, '0': 0x3a2200 }); gC.generateTexture('crawler', 9*2, 6*2); gC.destroy();
  const gB = this.add.graphics(); gB.fillStyle(0xff0000,1).fillRect(0,0,4,4); gB.generateTexture('bullet',4,4); gB.destroy();
  const gEB = this.add.graphics(); gEB.fillStyle(0x00e5ff,1).fillRect(0,0,4,6); gEB.generateTexture('ebullet',4,6); gEB.destroy();
  const gX = this.add.graphics(); gX.fillStyle(0xffff00,1).fillRect(0,0,6,6); gX.generateTexture('pixel',6,6); gX.destroy();
  const gH = this.add.graphics(); drawHeart(gH,2); gH.generateTexture('heart',14,12); gH.destroy();
  const gS = this.add.graphics(); drawSticky(gS,60,10); gS.generateTexture('sticky',60,10); gS.destroy();

  // Ammo cluster (bigger yellow chunk with outline)
  const gAC = this.add.graphics();
  gAC.fillStyle(0xffff66,1).fillRect(0,0,12,12);
  gAC.lineStyle(2,0x9a8700,1).strokeRect(1,1,10,10);
  gAC.generateTexture('ammoCluster',12,12);
  gAC.destroy();

  // Player
  player = this.physics.add.sprite(400, 520, 'player').setCollideWorldBounds(true);
  player.body.setGravityY(300);
  player.setData('slowedUntil', 0);
  player.setDepth(5); // ensure drawn above floor

  // Input
  cursors = this.input.keyboard.createCursorKeys();
  spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
  enterKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
  pKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.P);
  rKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);

  // Groups
  bullets      = this.physics.add.group({ defaultKey: 'bullet', maxSize: 140 });
  enemyBullets = this.physics.add.group({ defaultKey: 'ebullet', maxSize: 80 });
  enemies      = this.physics.add.group();
  crawlers     = this.physics.add.group();
  pixels       = this.physics.add.group(); // not used for drops now, but kept for compatibility
  hearts       = this.physics.add.group();
  stickies     = this.physics.add.staticGroup();
  floors       = this.physics.add.group();          // segmented moving floor
  ammoPacks    = this.physics.add.group();          // big ammo pickups (40)
  ammoClusters = this.physics.add.group();          // cluster pickups that settle on floor

  // UI
  scoreText = this.add.text(16, 12, 'Score: 0', { fontSize: '18px', fill: '#fff' }).setDepth(100);
  ammoText  = this.add.text(16, 34, 'Ammo: 100', { fontSize: '18px', fill: '#ffff66' }).setDepth(100);
  livesText = this.add.text(16, 56, 'Lives: 1', { fontSize: '18px', fill: '#ff8080' }).setDepth(100);

  scoreProgressBg  = this.add.graphics().fillStyle(0x555555, 1).fillRect(584, 16, 200, 16);
  scoreProgressBar = this.add.graphics();

  overlayText = this.add.text(400, 270, '', { fontSize: '30px', fill: '#00ffff', align: 'center' }).setOrigin(0.5).setDepth(101);
  statsText   = this.add.text(400, 330, '', { fontSize: '18px', fill: '#ffffff', align: 'center' }).setOrigin(0.5).setDepth(101);
  overlayText.setVisible(false); statsText.setVisible(false);

  // Collisions / overlaps
  this.physics.add.overlap(bullets, enemies, bulletHitEnemy, null, this);
  this.physics.add.overlap(player, pixels, playerHitPixel, null, this);

  this.physics.add.overlap(player, enemies, onPlayerDamagedByEnemy, null, this);
  this.physics.add.collider(player, crawlers, playerHitCrawler, null, this);

  this.physics.add.overlap(player, enemyBullets, onPlayerDamagedByBullet, null, this);
  this.physics.add.overlap(player, hearts, collectHeart, null, this);
  this.physics.add.overlap(player, stickies, onStickyOverlap, null, this);

  // Floor interactions
  this.physics.add.collider(player, floors);                 // stand on floor segments
  this.physics.add.collider(crawlers, floors);               // crawlers ride segments
  this.physics.add.collider(hearts, floors, heartTouchesFloor, null, this); // hearts → sticky on floor hit

  // Ammo pellets (single bullets) settle on floor and stay
  this.physics.add.collider(pixels, floors, ammoPelletTouchesFloor, null, this);
  // Enemy bullets should NOT sit on floor — destroy on impact
  this.physics.add.collider(enemyBullets, floors, destroyEnemyBullet, null, this);
  // Ammo clusters settle on floor and stay
  this.physics.add.collider(ammoClusters, floors, ammoClusterTouchesFloor, null, this);
  // Ammo packs settle on floor and stay
  this.physics.add.collider(ammoPacks, floors, ammoPackTouchesFloor, null, this);
  // Player collects ammo clusters and ammo packs
  this.physics.add.overlap(player, ammoClusters, playerHitAmmoCluster, null, this);
  this.physics.add.overlap(player, ammoPacks,    playerHitAmmoPack,    null, this);

  startLevel(this);
}

function update(time, delta) {
  if (Phaser.Input.Keyboard.JustDown(pKey)) togglePause(this);
  if (paused) { if (Phaser.Input.Keyboard.JustDown(rKey)) restartGame(this); return; }

  if (gameOver) {
    if (Phaser.Input.Keyboard.JustDown(enterKey) || Phaser.Input.Keyboard.JustDown(rKey)) restartGame(this);
    return;
  }

  updateFloors(this, time);

  // Ground/coyote
  const onGround = player.body.blocked.down || player.body.touching.down || player.body.onFloor();
  if (onGround) lastGroundedAt = time;

  // Sticky check
  const nowMS = this.time.now;
  const stickyActive = nowMS < (player.getData('slowedUntil') || 0);

  // Movement with sticky effect
  const baseSpeed = 300;
  const speed = stickyActive ? 80 : baseSpeed;
  if (stickyActive) { player.setDragX(1500); player.setMaxVelocity(160, 1000); player.setTint(0x66ccff); }
  else { player.setDragX(0); player.setMaxVelocity(500, 2000); player.clearTint(); }

  if (cursors.left.isDown) player.setVelocityX(-speed);
  else if (cursors.right.isDown) player.setVelocityX(speed);
  else if (stickyActive) player.setVelocityX(player.body.velocity.x * 0.9);
  else player.setVelocityX(0);

  // Single jump + coyote
  if (Phaser.Input.Keyboard.JustDown(cursors.up) && (onGround || time - lastGroundedAt <= COYOTE_MS)) {
    player.setVelocityY(stickyActive ? JUMP_VELOCITY * 0.8 : JUMP_VELOCITY);
  }

  // Shooting
  if (gameState === 'playing' && !overheated && spaceKey.isDown && time > lastFired) {
    if (pixelMeter > 0 && bullets.countActive(true) < MAX_ACTIVE_BULLETS) {
      // Ensure we don't exceed global active bullet cap or remaining ammo
      const canSpawn = Math.max(0, MAX_ACTIVE_BULLETS - bullets.countActive(true));
      const pellets = Math.min(PELLETS_PER_SHOT, canSpawn, pixelMeter);

      lastFired = time + SHOT_COOLDOWN_MS;

      if (pellets > 0) {
        shotsPressed++;
        spendPixels(pellets);
        shotsFired += pellets;

        for (let i = 0; i < pellets; i++) {
          const b = bullets.get(player.x, player.y - 20);
          if (b) {
            b.setActive(true).setVisible(true).setDepth(4);
            if (b.body) b.body.enable = true; // re-enable pooled body to avoid "stuck" bullets
            b.body.velocity.y = -520 + Phaser.Math.Between(-40, 40);
            b.body.velocity.x = Phaser.Math.Between(-80, 80);
          }
        }

        heat = Math.min(100, heat + 18 * (pellets / PELLETS_PER_SHOT));
        if (heat >= 100) { overheated = true; showOverlay(this, 'OVERHEATED!', 600); }
      }
    }
  }
  heat = Math.max(0, heat - (delta * 0.05));
  if (overheated && heat <= 40) overheated = false;

  // UI texts
  ammoText.setText('Ammo: ' + pixelMeter);
  livesText.setText('Lives: ' + lives);
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

  // Level end check
  if (gameState === 'playing'
      && enemiesToSpawn === 0
      && enemies.countActive() === 0
      && crawlers.countActive() === 0
      && enemyBullets.countActive(true) === 0) {

    const acc = accuracyPct();
    const dynTarget = getDynamicScoreTarget();
    if (levelScore >= dynTarget) {
      if (level < levelConfig.length) {
        gameState = 'levelComplete';
        showStats(this, `LEVEL ${level} CLEAR`, acc, enemiesKilled, levelScore, 'ENTER: NEXT');
        level++;
        const w = this.time.addEvent({
          delay: 50, loop: true, callback: () => {
            if (Phaser.Input.Keyboard.JustDown(enterKey)) {
              hideStats(); gameState = 'playing'; startLevel(this); w.remove(false);
            }
          }
        });
      } else {
        endGameWin(this, acc);
      }
    } else {
      gameState = 'levelFailed';
      showStats(this, `LEVEL ${level} FAILED`, acc, enemiesKilled, levelScore, 'ENTER: RETRY');
      this.physics.pause();
      const w = this.time.addEvent({
        delay: 50, loop: true, callback: () => {
          if (Phaser.Input.Keyboard.JustDown(enterKey)) {
            this.physics.resume(); hideStats(); gameState = 'playing'; resetLevelOnly(this); w.remove(false);
          }
        }
      });
    }
  }

  // Lose condition
  if (lives <= 0 && !gameOver) {
    gameOver = true; gameState = 'gameover'; this.physics.pause();
    showStats(this, 'GAME OVER', accuracyPct(), enemiesKilled, levelScore, 'ENTER/R: RESTART');
  }

  // Cleanup
  bullets.children.each(b => { if (b.active && (b.y < -10 || b.x < -10 || b.x > 810)) b.setActive(false).setVisible(false); });
  enemyBullets.children.each(b => { if (b.active && (b.y > 610 || b.x < -10 || b.x > 810)) b.setActive(false).setVisible(false); });
  pixels.children.each(p => { if (p.active && p.y > 610) p.setActive(false).setVisible(false); });
  enemies.children.each(e => { if (e.active && (e.x < -20 || e.x > 820 || e.y > 620)) e.setActive(false).setVisible(false); });
  crawlers.children.each(c => { if (c.active && (c.x < -30 || c.x > 830 || c.y > 620)) c.setActive(false).setVisible(false); });
}

// === Game logic helpers ===
function startLevel(scene) {
  const cfg = getLevelCfg(); if (!cfg) return;
  enemiesToSpawn = cfg.enemies;
  levelScore = 0;
  pixelMeter = Math.min(pixelMeter, MAX_PIXELS);
  shotsFired = 0; shotsHit = 0;
  shotsPressed = 0; enemiesKilled = 0;
  spawnedAirborne = 0; spawnedCrawlers = 0;
  heat = 0; overheated = false;
  clearGroupsForNewLevel(scene);
  buildFloors(scene);
  floorAmp = level >= 5 ? 40 : 0;
  ammoPacksDroppedThisLevel = 0;
  ammoPackCooldownUntil = 0;
  allowPackThisLevel = Math.random() < 0.5; // ~one pack every two levels on average
}

function resetLevelOnly(scene) {
  const cfg = getLevelCfg();
  enemiesToSpawn = cfg ? cfg.enemies : 0;
  levelScore = 0; shotsFired = 0; shotsHit = 0;
  shotsPressed = 0; enemiesKilled = 0;
  spawnedAirborne = 0; spawnedCrawlers = 0;
  heat = 0; overheated = false;
  pixelMeter = Math.max(30, pixelMeter);
  clearGroupsForNewLevel(scene);
  buildFloors(scene);
  ammoPacksDroppedThisLevel = 0; // allow packs again on retry
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
}

function endGameWin(scene, acc) {
  gameOver = true; gameState = 'gameover'; scene.physics.pause();
  showStats(scene, 'YOU WIN!', acc, enemiesKilled, levelScore, 'ENTER/R: RESTART');
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

  const s = Phaser.Math.FloatBetween(0.9, 1.3);
  e.setScale(s).setDepth(3);
  e.maxHealth = eType.health;
  e.health = eType.health;
  e.setAlpha(1);
  e.setSize(Math.round(eType.size.x * s), Math.round(eType.size.y * s));

  const xSpeed = side === 0 ? Phaser.Math.Between(60, 160) : Phaser.Math.Between(-160, -60);
  const ySpeed = Phaser.Math.Between(10, 40);
  e.setVelocity(xSpeed, ySpeed);
  // small visual tilt so bananas feel organic
  e.setAngle(Phaser.Math.Between(-12, 12));

  // Only SOME mid/high-tier fliers can shoot, and only from level 4+
  e.canShoot = false;
  if (level >= 4 && eType.health >= 2) e.canShoot = Math.random() < shooterChance(level);
  spawnedAirborne++;
}

function spawnCrawler(scene){
  const side = Phaser.Math.Between(0, 1);
  const startX = side === 0 ? -20 : 820;

  // pick nearest floor piece on that side; fall back to center piece
  let target = null, bestDist = Infinity;
  floors.children.iterate(seg => {
    const d = Math.abs(seg.x - (side === 0 ? 0 : 800));
    if (d < bestDist) { bestDist = d; target = seg; }
  });

  const y = (target ? target.y : 585) - 6;
  const c = crawlers.create(startX, y, 'crawler');
  const s = Phaser.Math.FloatBetween(1.1, 1.4);
  c.setScale(s).setDepth(6);
  c.setSize(Math.round(22 * s), Math.round(12 * s)).setOffset(0, 6);
  c.setImmovable(true);
  c.body.allowGravity = false;           // ensure it rides along the floor visually
  c.y = (target ? target.y : 585) - 8;   // pin to top of floor
  const vx = side === 0 ? Phaser.Math.Between(80, 140) : Phaser.Math.Between(-140, -80);
  c.setVelocityX(vx);
  spawnedCrawlers++;
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

function bulletHitEnemy(bullet, enemy) {
  bullets.killAndHide(bullet); if (bullet.body) bullet.body.enable = false;
  shotsHit++;

  enemy.health--;
  if (enemy.health > 0) {
    const a = 0.4 + 0.6 * (enemy.health / enemy.maxHealth);
    enemy.setAlpha(a);
    return;
  }

  // enemy dead
  enemies.killAndHide(enemy); if (enemy.body) enemy.body.enable = false;
  enemiesKilled++;

  score += 10; levelScore += 10;

  // ==== AMMO: drop 8 SINGLE PELLETS in a tight cluster ====
  // Each pellet is worth 1 ammo. Small offsets keep them close together.
  for (let i = 0; i < 8; i++) {
    const ox = Phaser.Math.Between(-8, 8);
    const oy = Phaser.Math.Between(-4, 4);
    const p = pixels.create(enemy.x + ox, enemy.y + oy, 'pixel');
    p.setData('value', 1);
    p.setDepth(2);
    p.setBounce(0.1);
    p.body.allowGravity = true;
    p.body.setGravityY(900);
    p.setVelocity(Phaser.Math.Between(-30, 30), Phaser.Math.Between(40, 120));
  }

  // ==== RARE/UNIQUE AMMO PACK (40): gated by low ammo, cooldown, and per-level cap ====
  if (shouldDropAmmoPack(this)) {
    const pack = ammoPacks.create(enemy.x, enemy.y, 'ammoPack');
    pack.setData('value', AMMO_PACK_VALUE);
    pack.setDepth(2);
    pack.setBounce(0.2);
    pack.body.allowGravity = true;
    pack.body.setGravityY(900);
    pack.setVelocity(Phaser.Math.Between(-40,40), Phaser.Math.Between(50,100));
    ammoPacksDroppedThisLevel += 1;
    ammoPackCooldownUntil = this.time.now + Phaser.Math.Between(6000, 9000); // 6–9s cooldown
  }

  // hearts still possible
  if (Math.random() < heartDropChance(level)) {
    const h = hearts.create(enemy.x, enemy.y, 'heart');
    h.setData('collected', false);
    h.setDepth(2);
    h.setBounce(0.2);
    h.body.allowGravity = true;
    h.body.setGravityY(900);
    h.setVelocity(Phaser.Math.Between(-40,40), Phaser.Math.Between(60,100));
  }
}

// Ammo cluster settles on floor: stop moving + no gravity (so it stays)
function ammoClusterTouchesFloor(cluster, seg){
  if (!cluster.active) return;
  cluster.body.allowGravity = false;
  cluster.setVelocity(0,0);
  cluster.setBounce(0);
}

// Ammo pack settles on floor: stop moving + no gravity (so it stays)
function ammoPackTouchesFloor(pack, seg){
  if (!pack.active) return;
  pack.body.allowGravity = false;
  pack.setVelocity(0,0);
  pack.setBounce(0);
}

// Single ammo pellet settles on floor
function ammoPelletTouchesFloor(pellet, seg){
  if (!pellet.active) return;
  pellet.body.allowGravity = false;
  pellet.setVelocity(0,0);
  pellet.setBounce(0);
  pellet.setData('expiresAt', pellet.scene.time.now + 6000); // 6s to collect
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
  ammoPacks.killAndHide(pack); if (pack.body) pack.body.enable = false;
  addPixels(pack.getData('value') || AMMO_PACK_VALUE);
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
  if (playerInvincible) return;
  damageLife(this);
}
function playerHitCrawler(player, crawler) {
  if (playerInvincible) return;
  damageLife(this);
}
function onPlayerDamagedByBullet(player, ebullet){
  if (playerInvincible) return;
  enemyBullets.killAndHide(ebullet); if (ebullet.body) ebullet.body.enable = false;
  damageLife(this);
}

function destroyEnemyBullet(bullet, seg){
  if (!bullet.active) return;
  enemyBullets.killAndHide(bullet); if (bullet.body) bullet.body.enable = false;
}

function damageLife(scene) {
  lives -= 1;
  scene.cameras.main.shake(120, 0.01);
  if (lives <= 0) return;
  playerInvincible = true; player.setAlpha(0.5);
  scene.time.addEvent({ delay: 1000, callback: () => { playerInvincible = false; player.setAlpha(1); } });
}

function buildFloors(scene){
  // remove any old pieces
  floors.clear(true, true);

  // early levels: single long bar (classic floor)
  if (level < 5) {
    const seg = scene.add.rectangle(400, 590, 800, 20, 0x3b3b3b);
    seg.setDepth(0);
    scene.physics.add.existing(seg);
    seg.body.allowGravity = false;
    seg.body.immovable = true;
    seg.setData('baseY', 590);
    seg.setData('amp', 0);
    seg.setData('phase', 0);
    floors.add(seg);
    return;
  }

  // later levels: the floor "becomes platforms"
  const pieces = (level < 7) ? 3 : 4;
  const gap = 40;
  const totalWidth = 800 - (gap * (pieces - 1));
  const segW = Math.floor(totalWidth / pieces);
  let x = segW / 2;

  for (let i = 0; i < pieces; i++) {
    const seg = scene.add.rectangle(x, 580, segW, 20, 0x3b3b3b);
    seg.setDepth(0);
    scene.physics.add.existing(seg);
    seg.body.allowGravity = false;
    seg.body.immovable = true;

    // wave params
    seg.setData('baseY', 580);
    seg.setData('amp', 40);
    seg.setData('phase', i * Math.PI * 0.6);
    floors.add(seg);

    x += segW + gap;
  }
}

function updateFloors(scene, t){
  const speed = 0.0025; // sine speed
  floors.children.iterate(seg => {
    if (!seg || !seg.body) return;
    const baseY = seg.getData('baseY') || 580;
    const amp   = seg.getData('amp')   || 0;
    const ph    = seg.getData('phase') || 0;
    const y = baseY - Math.sin(t * speed + ph) * amp;
    seg.y = y;
    seg.body.updateFromGameObject();
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

function togglePause(scene) {
  paused = !paused;
  scene.physics.world.isPaused = paused;
  overlayText.setText(paused ? 'PAUSED\nP: RESUME   R: RESTART' : '');
  overlayText.setVisible(paused);
  statsText.setVisible(false);
}

function showOverlay(scene, msg, autoHideMs = 0) {
  overlayText.setText(msg); overlayText.setVisible(true); statsText.setVisible(false);
  if (autoHideMs > 0) scene.time.addEvent({ delay: autoHideMs, callback: () => overlayText.setVisible(false) });
}
function showStats(scene, title, acc, hits, lvlScore, footer){
  overlayText.setText(title); statsText.setText(`Hits: ${hits}   Accuracy: ${acc}%   Level Score: ${lvlScore}\n${footer}`);
  overlayText.setVisible(true); statsText.setVisible(true);
}
function hideStats(){ overlayText.setVisible(false); statsText.setVisible(false); }

function restartGame(scene) { scene.scene.restart(); }
