// ─── State ───────────────────────────────────────────────────────────────────
let cardsData = [];
let cards = [];
let selectedCards = [];
let openaiApiKey = null;
/** Full shared style string for API (base + aspect + frame); null for legacy deck JSON. */
let deckSharedStylePrompt = null;

const MAX_SELECTED = 4;
const BASE_CARD_W = 120;
const BASE_CARD_H = 160;

// App phases: "deck" | "generating" | "reveal"
let phase = "deck";

// Reveal state
let revealImage = null;
let revealAlpha = 0;
let revealTitle = "";
let revealInterpretation = "";
let generationError = "";

// Loading animation
let loadingAngle = 0;
let loadingParticles = [];
let ambientSparkles = [];
let selectionBursts = [];
const RUNE_SYMBOLS = ["✦", "✧", "☽", "✺", "✷", "◇", "✶", "☉"];
const AMBIENT_SPARKLE_COUNT = 48;
const LOADING_PARTICLE_COUNT = 42;

function getLayoutScale() {
  // Keep layout readable across phones/tablets/desktop.
  return constrain(min(width / 1440, height / 900), 0.62, 1.12);
}

function getCardWidth() {
  return BASE_CARD_W * getLayoutScale();
}

function getCardHeight() {
  return BASE_CARD_H * getLayoutScale();
}

function getSelectedCardScale() {
  if (width < 520) return 1.2;
  if (width < 760) return 1.36;
  if (width < 1080) return 1.58;
  return 1.78;
}

// ─── Card Class ──────────────────────────────────────────────────────────────
class Card {
  constructor(index, img, concept, description, scene = null, keywords = null, shortMeaning = "", number = "") {
    this.index = index;
    this.img = img;
    this.concept = concept;
    this.description = description;
    /** Long prose scene when present (older deck JSON). */
    this.scene = scene;
    /** Short keyword tags when present (minimal deck JSON). */
    this.keywords = keywords;
    /** One-line card meaning shown while selecting cards. */
    this.shortMeaning = shortMeaning;
    /** Stable deck number, independent of shuffled display order. */
    this.number = number || String(index + 1).padStart(2, "0");

    // Current animated position / rotation / scale
    this.x = 0;
    this.y = 0;
    this.rotation = 0;
    this.scale = 1;

    // Target (for lerp animation)
    this.targetX = 0;
    this.targetY = 0;
    this.targetRotation = 0;
    this.targetScale = 1;

    // Fan home position
    this.homeX = 0;
    this.homeY = 0;
    this.homeRotation = 0;

    this.selected = false;
    this.hovered = false;
    this.alpha = 255;
    this.targetAlpha = 255;

    this.selectionSlot = -1; // 0-3 when selected
  }

  setHome(x, y, rot) {
    this.homeX = x;
    this.homeY = y;
    this.homeRotation = rot;
    this.targetX = x;
    this.targetY = y;
    this.targetRotation = rot;
    this.x = x;
    this.y = y;
    this.rotation = rot;
  }

  update() {
    const lerpSpeed = 0.08;
    this.x = lerp(this.x, this.targetX, lerpSpeed);
    this.y = lerp(this.y, this.targetY, lerpSpeed);
    this.rotation = lerp(this.rotation, this.targetRotation, lerpSpeed);
    this.scale = lerp(this.scale, this.targetScale, lerpSpeed);
    this.alpha = lerp(this.alpha, this.targetAlpha, lerpSpeed);
  }

  display() {
    push();
    const floatOffset = this.selected
      ? sin(frameCount * 0.055 + this.index) * 5
      : this.hovered
        ? sin(frameCount * 0.08 + this.index) * 3
        : sin(frameCount * 0.025 + this.index) * 1.2;

    translate(this.x, this.y + floatOffset);
    rotate(this.rotation);
    scale(this.scale);

    tint(255, this.alpha);
    const cardW = getCardWidth();
    const cardH = getCardHeight();

    // Subtle glow when hovered
    if (this.hovered && !this.selected && phase === "deck") {
      drawingContext.shadowColor = "rgba(232, 210, 150, 0.75)";
      drawingContext.shadowBlur = 16;
      drawCardAura(0, 0, cardW, cardH, this.alpha * 0.65, frameCount * 0.04 + this.index);
    }

    // Gold border for selected cards
    if (this.selected) {
      drawCardAura(0, 0, cardW, cardH, this.alpha, frameCount * 0.035 + this.index);
      drawingContext.shadowColor = "rgba(235, 205, 130, 0.9)";
      drawingContext.shadowBlur = 18;
      stroke(235, 205, 130, this.alpha);
      strokeWeight(2);
    } else {
      stroke(80, 70, 55, this.alpha * 0.5);
      strokeWeight(1);
    }

    imageMode(CENTER);
    image(this.img, 0, 0, cardW, cardH);
    rect(-cardW / 2, -cardH / 2, cardW, cardH, 4);

    if (this.hovered || this.selected) {
      drawCardSigils(cardW, cardH, this.alpha, this.index);
    }

    drawingContext.shadowBlur = 0;
    noTint();
    pop();
  }

  containsPoint(px, py) {
    const cosR = cos(-this.rotation);
    const sinR = sin(-this.rotation);
    const dx = px - this.x;
    const dy = py - this.y;
    const localX = dx * cosR - dy * sinR;
    const localY = dx * sinR + dy * cosR;
    const hw = (getCardWidth() * this.scale) / 2;
    const hh = (getCardHeight() * this.scale) / 2;
    return abs(localX) < hw && abs(localY) < hh;
  }
}

// ─── Loading Particle ────────────────────────────────────────────────────────
class LoadingParticle {
  constructor() {
    this.reset();
  }

  reset() {
    this.angle = random(TWO_PI);
    this.radius = random(60, 160);
    this.speed = random(0.005, 0.02);
    this.size = random(1.5, 4);
    this.alpha = random(80, 200);
    this.drift = random(-0.3, 0.3);
  }

  update() {
    this.angle += this.speed;
    this.radius += this.drift * 0.1;
    this.alpha -= 0.3;
    if (this.alpha <= 0) this.reset();
  }

  display(cx, cy) {
    const x = cx + cos(this.angle) * this.radius;
    const y = cy + sin(this.angle) * this.radius;
    noStroke();
    fill(210, 190, 140, this.alpha);
    ellipse(x, y, this.size);
  }
}

// ─── Magical Particles ───────────────────────────────────────────────────────
class AmbientSparkle {
  constructor() {
    this.reset(true);
  }

  reset(scatter = false) {
    this.x = random(width);
    this.y = scatter ? random(height) : height + random(20, 140);
    this.size = random(0.8, 3.2);
    this.speed = random(0.08, 0.45);
    this.drift = random(-0.22, 0.22);
    this.twinkleSpeed = random(0.025, 0.085);
    this.phase = random(TWO_PI);
    this.hueShift = random(1);
  }

  update() {
    this.phase += this.twinkleSpeed;
    this.x += sin(frameCount * 0.006 + this.phase) * this.drift;
    this.y -= this.speed;
    if (this.y < -20 || this.x < -40 || this.x > width + 40) this.reset();
  }

  display() {
    const pulse = 0.45 + sin(this.phase) * 0.55;
    const alpha = 38 + pulse * 135;
    const gold = this.hueShift > 0.28;
    noStroke();
    fill(gold ? 230 : 155, gold ? 205 : 145, gold ? 135 : 255, alpha);
    ellipse(this.x, this.y, this.size * (1 + pulse));
    stroke(gold ? 235 : 165, gold ? 215 : 155, gold ? 160 : 255, alpha * 0.55);
    strokeWeight(0.7);
    line(this.x - this.size * 2.5, this.y, this.x + this.size * 2.5, this.y);
    line(this.x, this.y - this.size * 2.5, this.x, this.y + this.size * 2.5);
  }
}

class SelectionBurst {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.age = 0;
    this.life = 34;
    this.particles = [];
    for (let i = 0; i < 12; i++) {
      this.particles.push({
        angle: random(TWO_PI),
        speed: random(1.8, 6.5),
        size: random(1.2, 4.5),
        spin: random(-0.08, 0.08),
        rune: random(RUNE_SYMBOLS),
      });
    }
  }

  update() {
    this.age++;
    return this.age < this.life;
  }

  display() {
    const t = this.age / this.life;
    const alpha = 255 * (1 - t);
    push();
    blendMode(ADD);
    noFill();
    stroke(235, 205, 130, alpha * 0.5);
    strokeWeight(1.2);
    ellipse(this.x, this.y, 24 + t * 160);
    ellipse(this.x, this.y, 8 + t * 90);
    for (const p of this.particles) {
      const dist = p.speed * this.age;
      const x = this.x + cos(p.angle) * dist;
      const y = this.y + sin(p.angle) * dist;
      push();
      translate(x, y);
      rotate(this.age * p.spin);
      noStroke();
      fill(245, 220, 150, alpha);
      textAlign(CENTER, CENTER);
      textSize(10 + p.size);
      text(p.rune, 0, 0);
      pop();
    }
    blendMode(BLEND);
    pop();
  }
}

// ─── p5.js Lifecycle ─────────────────────────────────────────────────────────
function preload() {
  cardsData = loadJSON("data/cards.json");
}

function setup() {
  pixelDensity(1);
  createCanvas(windowWidth, windowHeight);
  frameRate(45);
  angleMode(RADIANS);
  imageMode(CENTER);
  noFill();

  let dataArray;
  deckSharedStylePrompt = null;
  if (Array.isArray(cardsData)) {
    dataArray = cardsData;
  } else if (cardsData.cards && Array.isArray(cardsData.cards)) {
    dataArray = cardsData.cards;
    const st = cardsData.style;
    if (st) {
      if (Array.isArray(st.keywords) && st.keywords.length) {
        deckSharedStylePrompt = st.keywords.join(", ");
      } else {
        deckSharedStylePrompt = [st.base, st.aspect, st.frame].filter(Boolean).join(" ");
      }
    }
  } else {
    dataArray = Object.values(cardsData);
  }
  dataArray = shuffleArray(dataArray);

  // Load card images and create Card objects
  for (let i = 0; i < dataArray.length; i++) {
    const entry = dataArray[i];
    const img = loadImage("assets/thumbs/" + entry.filename);
    let description = entry.description;
    const scene = entry.scene != null ? entry.scene : null;
    const keywords = Array.isArray(entry.keywords) ? entry.keywords : null;
    const shortMeaning = typeof entry.shortMeaning === "string" ? entry.shortMeaning : "";
    const number = typeof entry.number === "string" ? entry.number : String(i + 1).padStart(2, "0");
    if (!description && keywords && keywords.length) {
      description = `${entry.concept}: ${keywords.join(", ")}`;
    } else if (!description && scene && !Array.isArray(cardsData) && cardsData.style) {
      const st = cardsData.style;
      if (Array.isArray(st.keywords) && st.keywords.length) {
        description = [st.keywords.join(", "), entry.concept, scene].join(". ");
      } else {
        description = [st.base, st.aspect, scene, st.frame].filter(Boolean).join(" ");
      }
    } else if (!description) {
      description = scene || "";
    }
    const card = new Card(i, img, entry.concept, description, scene, keywords, shortMeaning, number);
    cards.push(card);
  }

  layoutFan();

  // Init loading particles
  for (let i = 0; i < LOADING_PARTICLE_COUNT; i++) {
    loadingParticles.push(new LoadingParticle());
  }
  for (let i = 0; i < AMBIENT_SPARKLE_COUNT; i++) {
    ambientSparkles.push(new AmbientSparkle());
  }

  // ── UI Wiring ──────────────────────────────────────────────────────────
  const startBtn = document.getElementById("start-btn");
  const apiInput = document.getElementById("api-key-input");
  const overlay = document.getElementById("api-key-overlay");
  const genBtn = document.getElementById("generate-btn");
  const resetBtn = document.getElementById("reset-btn");

  startBtn.addEventListener("click", () => {
    const val = apiInput.value.trim();
    if (val.length > 5) {
      openaiApiKey = val;
      overlay.classList.add("fade-out");
      setTimeout(() => (overlay.style.display = "none"), 900);
    }
  });

  apiInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") startBtn.click();
  });

  genBtn.addEventListener("click", async () => {
    if (selectedCards.length !== MAX_SELECTED || phase !== "deck") return;
    genBtn.classList.add("hidden");
    phase = "generating";
    generationError = "";
    const selectedConcepts = selectedCards.map((c) => c.concept);
    revealTitle = buildRevealTitle(selectedConcepts);
    revealInterpretation = buildRevealInterpretation(selectedCards);

    // Fade unselected cards out
    for (const c of cards) {
      if (!c.selected) {
        c.targetAlpha = 0;
      }
    }

    try {
      const cardInfo = selectedCards.map((c) => ({
        concept: c.concept,
        description: c.description,
        scene: c.scene,
        keywords: c.keywords,
      }));
      const blob = await window.generatePersonalCard(
        cardInfo,
        openaiApiKey,
        deckSharedStylePrompt,
        revealTitle
      );
      const url = URL.createObjectURL(blob);
      loadImage(
        url,
        (img) => {
          revealImage = img;
          phase = "reveal";
          resetBtn.classList.remove("hidden");
          URL.revokeObjectURL(url);
        },
        () => {
          generationError = "Image decode failed. Please try again.";
          phase = "deck";
          genBtn.classList.remove("hidden");
          resetBtn.classList.add("hidden");
          for (const c of cards) {
            c.targetAlpha = 255;
          }
          URL.revokeObjectURL(url);
        }
      );
    } catch (err) {
      console.error("Generation failed:", err);
      generationError =
        err && err.message
          ? err.message
          : "Generation failed. Check OpenAI key/network and retry.";
      phase = "deck";
      genBtn.classList.remove("hidden");
      resetBtn.classList.add("hidden");
      for (const c of cards) {
        c.targetAlpha = 255;
      }
    }
  });

  resetBtn.addEventListener("click", () => {
    resetExperience();
  });
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  ambientSparkles = [];
  for (let i = 0; i < AMBIENT_SPARKLE_COUNT; i++) {
    ambientSparkles.push(new AmbientSparkle());
  }
  layoutFan();
  layoutSelectedSlots();
}

// ─── Fan Layout ──────────────────────────────────────────────────────────────
function layoutFan() {
  const totalCards = cards.length;
  const fanSpread = min(PI * 0.55, totalCards * 0.04);
  const fanRadius = max(width * 0.55, 500);
  const centerX = width / 2;
  const centerY = height + fanRadius * 0.42;

  for (let i = 0; i < totalCards; i++) {
    const card = cards[i];
    if (card.selected) continue;

    const t = totalCards > 1 ? i / (totalCards - 1) : 0.5;
    const angle = -HALF_PI - fanSpread / 2 + t * fanSpread;
    const x = centerX + cos(angle) * fanRadius;
    const y = centerY + sin(angle) * fanRadius;
    const rot = angle + HALF_PI;

    card.setHome(x, y, rot);
  }
}

// ─── Selection Slots ─────────────────────────────────────────────────────────
function getSlotPosition(slotIndex) {
  const slotSpacing = getSelectedSlotSpacing();
  const totalWidth = (MAX_SELECTED - 1) * slotSpacing;
  const startX = width / 2 - totalWidth / 2;
  return {
    x: startX + slotIndex * slotSpacing,
    y: height * (height < 760 ? 0.3 : 0.34),
  };
}

function getSelectedSlotSpacing() {
  const cardW = getCardWidth();
  const selectedScale = getSelectedCardScale();
  const desiredSpacing = cardW * selectedScale + max(10, 20 * getLayoutScale());
  const maxSpacing = (width * 0.9) / (MAX_SELECTED - 1);
  return min(desiredSpacing, maxSpacing);
}

function layoutSelectedSlots() {
  for (const card of selectedCards) {
    if (card.selectionSlot >= 0) {
      const pos = getSlotPosition(card.selectionSlot);
      card.targetX = pos.x;
      card.targetY = pos.y;
      card.targetRotation = 0;
      card.targetScale = getSelectedCardScale();
    }
  }
}

function getRevealSourceCardPosition(slotIndex, revealW, revealH) {
  const cardW = getCardWidth();
  const cardH = getCardHeight();

  if (width >= 920) {
    const scale = 0.72;
    const side = slotIndex < 2 ? -1 : 1;
    const sideSlot = slotIndex % 2;
    const x = width / 2 + side * (revealW / 2 + cardW * scale * 0.64 + 50 * getLayoutScale());
    const y = height / 2 + (sideSlot === 0 ? -0.2 : 0.2) * revealH;
    return {
      x,
      y,
      scale,
      rotation: side * (sideSlot === 0 ? -0.12 : 0.12),
    };
  }

  const scale = width < 620 ? 0.5 : 0.58;
  const slotSpacing = cardW * scale + max(8, 16 * getLayoutScale());
  const totalWidth = (MAX_SELECTED - 1) * slotSpacing;
  const startX = width / 2 - totalWidth / 2;
  const arc = [-0.1, -0.035, 0.035, 0.1];
  return {
    x: startX + slotIndex * slotSpacing,
    y: max(58, height / 2 - revealH / 2 - cardH * scale * 0.44),
    scale,
    rotation: arc[slotIndex] || 0,
  };
}

// ─── Draw ────────────────────────────────────────────────────────────────────
function draw() {
  background(10, 10, 15);

  // Ambient background texture
  drawBackground();

  if (phase === "deck" || phase === "generating") {
    // Update hover state
    if (phase === "deck") {
      for (let i = cards.length - 1; i >= 0; i--) {
        cards[i].hovered = false;
      }
      for (let i = cards.length - 1; i >= 0; i--) {
        if (!cards[i].selected && cards[i].containsPoint(mouseX, mouseY)) {
          cards[i].hovered = true;
          cards[i].targetScale = 1.12;
          break;
        }
      }
      for (const c of cards) {
        if (!c.hovered && !c.selected) c.targetScale = 1;
      }
    }

    // Draw unselected cards (bottom layer)
    for (const c of cards) {
      if (!c.selected) {
        c.update();
        c.display();
      }
    }

    // Draw selected cards (top layer)
    for (const c of selectedCards) {
      c.update();
      c.display();
    }

    drawSelectionBursts();

    if (phase === "deck" && selectedCards.length === 0) {
      drawPickFourPrompt();
    }

    if (phase === "deck") {
      drawSelectedCardReadings();
    }

    // Selection count indicator
    if (openaiApiKey && selectedCards.length > 0 && selectedCards.length < MAX_SELECTED) {
      drawSelectionHint();
    }

    if (phase === "generating") {
      drawLoadingAnimation();
    }
  }

  if (phase === "reveal") {
    drawReveal();
  }

  if (generationError) {
    drawGenerationError();
  }
}

// ─── Background Ambiance ─────────────────────────────────────────────────────
function drawBackground() {
  noStroke();
  for (let i = 0; i < 3; i++) {
    const x = width / 2 + sin(frameCount * 0.003 + i * 2) * width * 0.2;
    const y = height / 2 + cos(frameCount * 0.004 + i * 3) * height * 0.15;
    fill(30, 25, 45, 8);
    ellipse(x, y, 500 + sin(frameCount * 0.005 + i) * 100);
  }

  drawArcaneCircle(width / 2, height * 0.5, min(width, height) * 0.38, 30, frameCount * 0.0015);
  drawConstellationWeb();

  push();
  blendMode(ADD);
  for (const sparkle of ambientSparkles) {
    sparkle.update();
    sparkle.display();
  }
  blendMode(BLEND);
  pop();
}

function drawArcaneCircle(cx, cy, radius, alpha, spin, detailed = false) {
  if (radius < 120) return;

  push();
  translate(cx, cy);
  rotate(spin);
  blendMode(ADD);
  noFill();
  stroke(120, 100, 205, alpha * 0.45);
  strokeWeight(1);
  ellipse(0, 0, radius * 2);
  stroke(220, 190, 125, alpha * 0.36);
  ellipse(0, 0, radius * 1.52);

  const spokeCount = detailed ? 18 : 10;
  for (let i = 0; i < spokeCount; i++) {
    const a = (TWO_PI / spokeCount) * i;
    const inner = radius * 0.76;
    const outer = radius;
    stroke(220, 190, 125, alpha * (i % 3 === 0 ? 0.48 : 0.18));
    line(cos(a) * inner, sin(a) * inner, cos(a) * outer, sin(a) * outer);
  }

  if (detailed) {
    rotate(-spin * 2.2);
    textAlign(CENTER, CENTER);
    textSize(max(10, min(14, radius * 0.032)));
    noStroke();
    for (let i = 0; i < RUNE_SYMBOLS.length; i += 2) {
      const a = (TWO_PI / RUNE_SYMBOLS.length) * i + frameCount * 0.0008;
      fill(225, 205, 145, alpha * (0.34 + 0.2 * sin(frameCount * 0.03 + i)));
      text(RUNE_SYMBOLS[i], cos(a) * radius * 0.64, sin(a) * radius * 0.64);
    }
  }
  blendMode(BLEND);
  pop();
}

function drawConstellationWeb() {
  const points = 9;
  push();
  blendMode(ADD);
  strokeWeight(0.7);
  for (let i = 0; i < points; i++) {
    const a = frameCount * 0.002 + i * 1.7;
    const x = width * (0.18 + ((sin(a * 0.7) + 1) * 0.32));
    const y = height * (0.16 + ((cos(a * 0.9 + i) + 1) * 0.26));
    const nx = width * (0.18 + ((sin((a + 1.7) * 0.7) + 1) * 0.32));
    const ny = height * (0.16 + ((cos((a + 1.7) * 0.9 + i + 1) + 1) * 0.26));
    stroke(125, 115, 210, 18 + 10 * sin(frameCount * 0.02 + i));
    line(x, y, nx, ny);
    noStroke();
    fill(225, 205, 145, 45 + 25 * sin(frameCount * 0.03 + i));
    ellipse(x, y, 2.2);
  }
  blendMode(BLEND);
  pop();
}

function drawCardAura(x, y, cardW, cardH, alpha, phaseOffset) {
  push();
  blendMode(ADD);
  noFill();
  const pulse = 0.5 + sin(phaseOffset) * 0.5;
  stroke(230, 200, 130, alpha * (0.18 + pulse * 0.18));
  strokeWeight(1);
  rect(x - cardW / 2 - 8, y - cardH / 2 - 8, cardW + 16, cardH + 16, 10);
  stroke(145, 125, 255, alpha * (0.1 + pulse * 0.12));
  rect(x - cardW / 2 - 15, y - cardH / 2 - 15, cardW + 30, cardH + 30, 14);
  blendMode(BLEND);
  pop();
}

function drawCardSigils(cardW, cardH, alpha, seed) {
  push();
  textAlign(CENTER, CENTER);
  textSize(12);
  noStroke();
  fill(245, 220, 150, alpha * (0.42 + 0.18 * sin(frameCount * 0.06 + seed)));
  const inset = 13;
  text(RUNE_SYMBOLS[seed % RUNE_SYMBOLS.length], -cardW / 2 + inset, -cardH / 2 + inset);
  text(RUNE_SYMBOLS[(seed + 7) % RUNE_SYMBOLS.length], cardW / 2 - inset, cardH / 2 - inset);
  pop();
}

function drawSelectionBursts() {
  selectionBursts = selectionBursts.filter((burst) => {
    burst.display();
    return burst.update();
  });
}

function drawPickFourPrompt() {
  push();
  const promptY = height * (height < 760 ? 0.17 : 0.2) + sin(frameCount * 0.035) * 3;
  const glow = 0.5 + sin(frameCount * 0.04) * 0.5;
  textAlign(CENTER, CENTER);
  textFont("Georgia");
  textSize(max(15, min(23, width * 0.018)));
  textStyle(ITALIC);
  drawingContext.shadowColor = `rgba(170, 130, 255, ${0.12 + glow * 0.14})`;
  drawingContext.shadowBlur = 16;
  fill(248, 228, 174, 150 + glow * 42);
  noStroke();
  text("Pick 4 cards with your heart", width / 2, promptY);

  drawingContext.shadowBlur = 0;
  stroke(230, 205, 145, 38 + glow * 34);
  strokeWeight(0.8);
  const lineW = min(86, width * 0.1);
  line(width / 2 - lineW - 130 * getLayoutScale(), promptY, width / 2 - 48 * getLayoutScale(), promptY);
  line(width / 2 + 48 * getLayoutScale(), promptY, width / 2 + lineW + 130 * getLayoutScale(), promptY);

  noStroke();
  fill(248, 228, 174, 95 + glow * 62);
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const x = width / 2 + side * (lineW + 100 * getLayoutScale());
    const sparkleSize = 3 + sin(frameCount * 0.08 + i * PI) * 0.9;
    ellipse(x, promptY, sparkleSize);
    ellipse(x + side * 14, promptY - 8, sparkleSize * 0.55);
  }
  drawingContext.shadowBlur = 0;
  textStyle(NORMAL);
  pop();
}

function drawSelectedCardReadings() {
  if (!selectedCards.length) return;

  const cardH = getCardHeight() * getSelectedCardScale();
  const gap = max(8, 14 * getLayoutScale());
  const totalW = min(width - 30, width * 0.9);
  const panelW = (totalW - gap * (MAX_SELECTED - 1)) / MAX_SELECTED;
  const panelH = height < 760 ? 96 : 108;
  const startX = width / 2 - totalW / 2;
  const alpha = 210;

  for (const card of selectedCards) {
    const slot = card.selectionSlot >= 0 ? card.selectionSlot : selectedCards.indexOf(card);
    const pos = getSlotPosition(slot);
    const drift = sin(frameCount * 0.025 + slot * 1.7) * 3;
    const panelX = startX + slot * (panelW + gap);
    const panelY = min(height - panelH - 76, pos.y + cardH / 2 + 16 + (slot % 2) * 8 + drift);
    const summary = buildCardReadingSummary(card);

    push();
    blendMode(BLEND);
    drawingContext.shadowColor = "rgba(0, 0, 0, 0.42)";
    drawingContext.shadowBlur = 14;
    noStroke();
    fill(22, 17, 18, alpha * 0.78);
    rect(panelX, panelY, panelW, panelH, 16);

    drawingContext.shadowBlur = 0;
    stroke(221, 190, 118, alpha * 0.36);
    strokeWeight(0.8);
    line(pos.x, pos.y + cardH / 2 + 2, panelX + panelW / 2, panelY + 2);

    noFill();
    stroke(231, 204, 142, alpha * 0.42);
    rect(panelX + 5, panelY + 5, panelW - 10, panelH - 10, 13);
    stroke(130, 105, 210, alpha * 0.18);
    rect(panelX + 11, panelY + 11, panelW - 22, panelH - 22, 10);

    noStroke();
    fill(231, 204, 142, alpha * 0.86);
    ellipse(panelX + panelW / 2, panelY + 5, 5);
    textAlign(CENTER, CENTER);
    textFont("Georgia");
    textStyle(ITALIC);
    textSize(max(9, min(11, panelW * 0.075)));
    fill(231, 204, 142, alpha * 0.72);
    text(card.number, panelX + panelW / 2, panelY + 18);

    noStroke();
    drawingContext.shadowColor = "rgba(0, 0, 0, 0.75)";
    drawingContext.shadowBlur = 4;
    fill(255, 238, 190, 255);
    drawFittedText(card.concept, panelX + 9, panelY + 28, panelW - 18, panelH * 0.42, 11.5, 8, true);

    fill(238, 224, 190, 245);
    drawFittedText(summary, panelX + 9, panelY + panelH * 0.72, panelW - 18, panelH * 0.22, 11.5, 8, false);
    drawingContext.shadowBlur = 0;
    pop();
  }
}

function drawFittedText(value, x, y, boxW, boxH, maxSize, minSize, isBold) {
  const textValue = String(value || "").trim();
  if (!textValue) return;

  textAlign(CENTER, TOP);
  textStyle(isBold ? BOLD : NORMAL);

  for (let size = maxSize; size >= minSize; size -= 0.5) {
    textSize(size);
    textLeading(size * 1.16);
    const lines = wrapTextLines(textValue, boxW);
    if (lines.length * size * 1.16 <= boxH) {
      drawWrappedLines(lines, x, y, boxW, size * 1.16);
      return;
    }
  }

  textSize(minSize);
  textLeading(minSize * 1.12);
  drawWrappedLines(wrapTextLines(textValue, boxW), x, y, boxW, minSize * 1.12);
}

function wrapTextLines(value, boxW) {
  const words = String(value || "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (!line || textWidth(next) <= boxW) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }

  if (line) lines.push(line);
  return lines;
}

function drawWrappedLines(lines, x, y, boxW, leading) {
  for (let i = 0; i < lines.length; i++) {
    text(lines[i], x + boxW / 2, y + i * leading);
  }
}

function buildCardReadingSummary(card) {
  if (typeof card.shortMeaning === "string" && card.shortMeaning.trim()) {
    return card.shortMeaning.trim();
  }

  if (Array.isArray(card.keywords) && card.keywords.length) {
    const focus = formatShortList(card.keywords.slice(0, 2));
    const templates = [
      `It points to ${focus}.`,
      `It carries ${focus}.`,
      `It asks you to notice ${focus}.`,
      `It brings ${focus} into the reading.`,
    ];
    return templates[hashString(card.concept + focus) % templates.length];
  }

  const source = card.scene || card.description || "";
  const clean = String(source)
    .replace(/\s+/g, " ")
    .split(/[.!?]/)[0]
    .trim();
  if (!clean) return "It opens a quiet part of the reading.";
  return `It suggests ${truncateText(clean.toLowerCase(), width < 760 ? 34 : 48)}.`;
}

function formatShortList(items) {
  const clean = items.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  if (clean.length === 0) return "a subtle message";
  if (clean.length === 1) return clean[0];
  return `${clean[0]} and ${clean[1]}`;
}

function truncateText(value, maxLength) {
  const textValue = String(value || "").trim();
  if (textValue.length <= maxLength) return textValue;
  return textValue.slice(0, maxLength - 1).trimEnd() + "…";
}

// ─── Selection Hint ──────────────────────────────────────────────────────────
function drawSelectionHint() {
  push();
  textAlign(CENTER, CENTER);
  textSize(12);
  fill(210, 190, 140, 110 + sin(frameCount * 0.04) * 35);
  noStroke();
  text(
    selectedCards.length + " of " + MAX_SELECTED + " cards chosen",
    width / 2,
    height - 22
  );
  pop();
}

// ─── Loading Animation ──────────────────────────────────────────────────────
function drawLoadingAnimation() {
  loadingAngle += 0.02;
  const cx = width / 2;
  const cy = height * (height < 760 ? 0.28 : 0.32);

  // Orbiting ring
  push();
  blendMode(ADD);
  noFill();
  stroke(210, 190, 140, 60);
  strokeWeight(1);
  translate(cx, cy);
  rotate(loadingAngle);
  ellipse(0, 0, 300, 300);
  rotate(-loadingAngle * 1.8);
  stroke(140, 120, 245, 38);
  ellipse(0, 0, 236, 236);
  drawArcaneCircle(0, 0, 128, 70, loadingAngle * 0.7, false);
  for (let i = 0; i < 6; i++) {
    const a = (TWO_PI / 6) * i;
    const r = 150;
    fill(210, 190, 140, 100 + sin(loadingAngle * 3 + i) * 80);
    noStroke();
    ellipse(cos(a) * r, sin(a) * r, 5);
  }
  blendMode(BLEND);
  pop();

  // Particles
  for (const p of loadingParticles) {
    p.update();
    p.display(cx, cy);
  }

  // Text
  push();
  textAlign(CENTER, CENTER);
  textSize(13);
  fill(210, 190, 140, 150 + sin(frameCount * 0.06) * 60);
  noStroke();
  text("Weaving your fate...", cx, cy + min(height * 0.25, 200));
  pop();
}

function drawGenerationError() {
  push();
  textAlign(CENTER, CENTER);
  textSize(max(11, min(13, width * 0.012)));
  fill(220, 120, 120, 220);
  noStroke();
  text(generationError, width / 2, height - 30);
  pop();
}

// ─── Reveal ──────────────────────────────────────────────────────────────────
function drawReveal() {
  if (!revealImage) return;

  revealAlpha = lerp(revealAlpha, 255, 0.03);

  const compactReveal = height < 760;
  const maxW = width * (width < 900 ? 0.58 : 0.42);
  // Leave a dedicated reading area under the generated card.
  const maxH = height * (compactReveal ? 0.44 : 0.58);
  const imgRatio = revealImage.width / revealImage.height;
  let drawW, drawH;
  if (imgRatio > maxW / maxH) {
    drawW = maxW;
    drawH = maxW / imgRatio;
  } else {
    drawH = maxH;
    drawW = maxH * imgRatio;
  }

  drawRevealMagic(width / 2, height / 2, max(drawW, drawH), revealAlpha);

  push();
  imageMode(CENTER);
  tint(255, revealAlpha);

  // Glow behind card
  drawingContext.shadowColor = `rgba(210, 190, 140, ${revealAlpha / 600})`;
  drawingContext.shadowBlur = 28;

  image(revealImage, width / 2, height / 2, drawW, drawH);

  drawMainRevealFrame(width / 2, height / 2, drawW, drawH, revealAlpha);

  drawingContext.shadowBlur = 0;
  noTint();
  pop();

  // Title
  if (revealAlpha > 100) {
    const concepts = selectedCards.map((c) => c.concept);
    const titleY = min(height - (compactReveal ? 126 : 156), height / 2 + drawH / 2 + 38);
    const interpretationWidth = min(drawW * 1.5, width * (width < 900 ? 0.86 : 0.72));
    const interpretationX = width / 2 - interpretationWidth / 2;

    drawRevealReadingPanel(
      revealTitle || "Your Card of Becoming",
      concepts.join("  ·  "),
      revealInterpretation ||
        "You are crossing from old patterns into a clearer becoming. Keep what is true, release what is heavy, and move one steady step at a time.",
      interpretationX,
      interpretationWidth,
      titleY
    );
  }

  drawRevealSourceCards(drawW, drawH);
}

function drawRevealMagic(cx, cy, size, alpha) {
  push();
  blendMode(ADD);
  noFill();
  drawingContext.shadowColor = `rgba(220, 190, 130, ${alpha / 420})`;
  drawingContext.shadowBlur = 18;
  drawArcaneCircle(cx, cy, size * 0.63, alpha * 0.3, frameCount * 0.002, true);
  stroke(145, 120, 255, alpha * 0.18);
  strokeWeight(1);
  for (let i = 0; i < 2; i++) {
    const wobble = sin(frameCount * 0.02 + i) * 10;
    ellipse(cx, cy, size * (0.75 + i * 0.12) + wobble, size * (0.75 + i * 0.12) - wobble);
  }
  for (let i = 0; i < 8; i++) {
    const a = frameCount * 0.006 + (TWO_PI / 8) * i;
    const r = size * (0.5 + 0.08 * sin(frameCount * 0.025 + i));
    noStroke();
    fill(245, 220, 150, alpha * (0.22 + 0.2 * sin(frameCount * 0.04 + i)));
    textAlign(CENTER, CENTER);
    textSize(11);
    text(RUNE_SYMBOLS[i % RUNE_SYMBOLS.length], cx + cos(a) * r, cy + sin(a) * r);
  }
  drawingContext.shadowBlur = 0;
  blendMode(BLEND);
  pop();
}

function drawMainRevealFrame(cx, cy, cardW, cardH, alpha) {
  const x = cx - cardW / 2;
  const y = cy - cardH / 2;
  const corner = min(32, cardW * 0.12);

  push();
  noFill();
  strokeWeight(1.2);
  stroke(236, 211, 145, alpha * 0.62);
  rect(x - 4, y - 4, cardW + 8, cardH + 8, 9);
  stroke(135, 115, 220, alpha * 0.24);
  rect(x - 12, y - 12, cardW + 24, cardH + 24, 14);

  stroke(246, 224, 160, alpha * 0.76);
  strokeWeight(1.6);
  line(x - 14, y + corner, x - 14, y - 14);
  line(x - 14, y - 14, x + corner, y - 14);
  line(x + cardW + 14, y + corner, x + cardW + 14, y - 14);
  line(x + cardW + 14, y - 14, x + cardW - corner, y - 14);
  line(x - 14, y + cardH - corner, x - 14, y + cardH + 14);
  line(x - 14, y + cardH + 14, x + corner, y + cardH + 14);
  line(x + cardW + 14, y + cardH - corner, x + cardW + 14, y + cardH + 14);
  line(x + cardW + 14, y + cardH + 14, x + cardW - corner, y + cardH + 14);

  noStroke();
  fill(246, 224, 160, alpha * 0.82);
  ellipse(x - 14, y - 14, 4);
  ellipse(x + cardW + 14, y - 14, 4);
  ellipse(x - 14, y + cardH + 14, 4);
  ellipse(x + cardW + 14, y + cardH + 14, 4);
  pop();
}

function drawRevealReadingPanel(title, concepts, interpretation, x, panelW, titleY) {
  const compact = height < 760;
  const textY = min(titleY, height - (compact ? 136 : 166));
  const alpha = constrain((revealAlpha - 95) * 2.4, 0, 235);

  push();
  noStroke();
  textFont("Georgia");
  textAlign(CENTER, CENTER);
  textStyle(ITALIC);
  textSize(max(18, min(25, width * 0.02)));
  drawingContext.shadowColor = `rgba(0, 0, 0, ${alpha / 240})`;
  drawingContext.shadowBlur = 8;
  fill(246, 225, 168, alpha);
  text(title, width / 2, textY);

  textStyle(NORMAL);
  textSize(max(9.5, min(11.5, width * 0.01)));
  fill(218, 195, 140, alpha * 0.68);
  text(concepts, width / 2, textY + 24);

  drawingContext.shadowBlur = 0;
  stroke(220, 190, 125, alpha * 0.28);
  strokeWeight(0.8);
  line(width / 2 - panelW * 0.2, textY + 42, width / 2 + panelW * 0.2, textY + 42);

  textAlign(CENTER, TOP);
  textSize(max(12.5, min(15.5, width * 0.013)));
  textLeading(max(18, min(23, width * 0.019)));
  drawingContext.shadowColor = `rgba(0, 0, 0, ${alpha / 230})`;
  drawingContext.shadowBlur = 7;
  noStroke();
  fill(242, 226, 190, alpha * 0.95);
  text(
    interpretation,
    x,
    textY + (compact ? 50 : 56),
    panelW,
    compact ? 52 : 64
  );
  drawingContext.shadowBlur = 0;
  textStyle(NORMAL);
  pop();
}

function drawRevealSourceCards(revealW, revealH) {
  if (!selectedCards.length) return;

  const positions = selectedCards.map((card, index) => {
    const slot = card.selectionSlot >= 0 ? card.selectionSlot : index;
    return getRevealSourceCardPosition(slot, revealW, revealH);
  });

  drawRevealSourceLinks(positions, revealW, revealH);

  for (let i = 0; i < selectedCards.length; i++) {
    const card = selectedCards[i];
    const pos = positions[i];
    drawSourceCardPedestal(pos, i, card.concept);
    card.targetX = pos.x;
    card.targetY = pos.y;
    card.targetRotation = pos.rotation + sin(frameCount * 0.018 + i) * 0.018;
    card.targetScale = pos.scale;
    card.targetAlpha = 218;
    card.update();
    card.display();
  }
}

function drawSourceCardPedestal(pos, index, concept) {
  const cardW = getCardWidth() * pos.scale;
  const cardH = getCardHeight() * pos.scale;
  const plaqueW = cardW + 28;
  const plaqueH = cardH + 30;
  const alpha = min(190, revealAlpha * 0.5);
  const numerals = ["I", "II", "III", "IV"];

  push();
  translate(pos.x, pos.y);
  rotate(pos.rotation);
  drawingContext.shadowColor = `rgba(0, 0, 0, ${alpha / 420})`;
  drawingContext.shadowBlur = 16;
  noStroke();
  fill(8, 7, 14, alpha * 0.78);
  rect(-plaqueW / 2, -plaqueH / 2, plaqueW, plaqueH, 13);

  drawingContext.shadowBlur = 0;
  noFill();
  stroke(221, 192, 122, alpha * 0.42);
  strokeWeight(1);
  rect(-plaqueW / 2 + 5, -plaqueH / 2 + 5, plaqueW - 10, plaqueH - 10, 10);
  stroke(125, 105, 215, alpha * 0.18);
  rect(-plaqueW / 2 + 11, -plaqueH / 2 + 11, plaqueW - 22, plaqueH - 22, 8);

  noStroke();
  fill(236, 212, 150, alpha * 0.82);
  textAlign(CENTER, CENTER);
  textSize(max(9, cardW * 0.11));
  text(numerals[index] || String(index + 1), 0, -plaqueH / 2 + 13);

  textSize(max(7, min(10, cardW * 0.08)));
  fill(218, 195, 140, alpha * 0.62);
  const label = String(concept || "").slice(0, 16);
  text(label, 0, plaqueH / 2 - 12);
  pop();
}

function drawRevealSourceLinks(positions, revealW, revealH) {
  push();
  blendMode(ADD);
  noFill();
  strokeWeight(0.8);
  const alpha = min(150, revealAlpha * 0.38);
  const cardTop = height / 2 - revealH / 2;

  if (width >= 920) {
    const leftAnchorX = width / 2 - revealW / 2 - 10;
    const rightAnchorX = width / 2 + revealW / 2 + 10;
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      const anchorX = p.x < width / 2 ? leftAnchorX : rightAnchorX;
      const anchorY = height / 2 + (i % 2 === 0 ? -0.16 : 0.16) * revealH;
      stroke(210, 190, 140, alpha);
      line(p.x, p.y, anchorX, anchorY);
      noStroke();
      fill(230, 205, 145, alpha * 1.2);
      ellipse(anchorX, anchorY, 3.5 + sin(frameCount * 0.05 + i) * 1.2);
    }
  } else {
    beginShape();
    stroke(210, 190, 140, alpha * 0.75);
    for (const p of positions) {
      curveVertex(p.x, p.y + getCardHeight() * p.scale * 0.58);
    }
    endShape();
  }

  textAlign(CENTER, CENTER);
  textSize(max(9, min(11, width * 0.01)));
  noStroke();
  fill(210, 190, 140, min(125, revealAlpha * 0.38));
  const labelY = width >= 920 ? cardTop - 18 : max(26, positions[0].y - getCardHeight() * positions[0].scale * 0.64);
  text("four sources woven into one", width / 2, labelY);
  blendMode(BLEND);
  pop();
}

// ─── Interaction ─────────────────────────────────────────────────────────────
function mousePressed() {
  if (phase !== "deck" || !openaiApiKey) return;

  // Check if clicking a selected card (to deselect)
  for (let i = selectedCards.length - 1; i >= 0; i--) {
    const c = selectedCards[i];
    if (c.containsPoint(mouseX, mouseY)) {
      deselectCard(c);
      return;
    }
  }

  // Check if clicking an unselected card
  if (selectedCards.length < MAX_SELECTED) {
    for (let i = cards.length - 1; i >= 0; i--) {
      const c = cards[i];
      if (!c.selected && c.containsPoint(mouseX, mouseY)) {
        selectCard(c);
        return;
      }
    }
  }
}

function selectCard(card) {
  card.selected = true;
  card.selectionSlot = selectedCards.length;
  selectedCards.push(card);
  selectionBursts.push(new SelectionBurst(card.x, card.y));

  const pos = getSlotPosition(card.selectionSlot);
  card.targetX = pos.x;
  card.targetY = pos.y;
  card.targetRotation = 0;
  card.targetScale = getSelectedCardScale();

  updateGenerateButton();
}

function deselectCard(card) {
  const slot = card.selectionSlot;
  card.selected = false;
  card.selectionSlot = -1;
  card.targetX = card.homeX;
  card.targetY = card.homeY;
  card.targetRotation = card.homeRotation;
  card.targetScale = 1;

  selectedCards = selectedCards.filter((c) => c !== card);

  // Re-assign slots for remaining selected cards
  for (let i = 0; i < selectedCards.length; i++) {
    selectedCards[i].selectionSlot = i;
    const pos = getSlotPosition(i);
    selectedCards[i].targetX = pos.x;
    selectedCards[i].targetY = pos.y;
  }

  updateGenerateButton();
}

function updateGenerateButton() {
  const btn = document.getElementById("generate-btn");
  const resetBtn = document.getElementById("reset-btn");
  if (phase !== "deck") {
    btn.classList.add("hidden");
    resetBtn.classList.toggle("hidden", phase !== "reveal");
    return;
  }
  resetBtn.classList.add("hidden");
  if (selectedCards.length === MAX_SELECTED) {
    btn.classList.remove("hidden");
  } else {
    btn.classList.add("hidden");
  }
}

function resetExperience() {
  phase = "deck";
  revealImage = null;
  revealAlpha = 0;
  revealTitle = "";
  revealInterpretation = "";
  generationError = "";

  for (const c of selectedCards) {
    c.selected = false;
    c.selectionSlot = -1;
    c.targetScale = 1;
    c.targetAlpha = 255;
  }
  selectedCards = [];

  for (const c of cards) {
    c.hovered = false;
    c.selected = false;
    c.selectionSlot = -1;
    c.targetScale = 1;
    c.targetAlpha = 255;
  }

  cards = shuffleArray(cards);
  layoutFan();
  updateGenerateButton();
}

function buildRevealTitle(concepts) {
  const clean = concepts
    .filter((s) => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim())
    .sort((a, b) => a.localeCompare(b));
  const seed = clean.join("|") || "becoming";
  const adjectives = [
    "Quiet",
    "Hidden",
    "Liminal",
    "Hollow",
    "Golden",
    "Broken",
    "Tender",
    "Velvet",
    "Inner",
    "Silent",
  ];
  const nouns = [
    "Axis",
    "Threshold",
    "Mirror",
    "Current",
    "Beacon",
    "Echo",
    "Veil",
    "Compass",
    "Ember",
    "Tide",
  ];
  const a = adjectives[hashString(seed + "a") % adjectives.length];
  const n = nouns[hashString(seed + "n") % nouns.length];
  return `${a} ${n}`;
}

function buildRevealInterpretation(concepts) {
  const cardsForReading = concepts
    .map((entry) => {
      if (typeof entry === "string") {
        return { concept: entry, keywords: [] };
      }
      return entry;
    })
    .filter((entry) => typeof entry.concept === "string" && entry.concept.trim().length > 0);

  const names = cardsForReading.map((entry) => entry.concept.trim());
  const seed = names.join("|") || "becoming";
  const [first = "the first sign", second = "the second sign", third = "the hidden sign", fourth = "the final sign"] = names;
  const [keywordA, keywordB] = pickReadingKeywords(cardsForReading, seed, 2);
  const nextSteps = [
    "Make one small decision.",
    "Slow down before choosing.",
    "Choose what gives you room.",
    "Finish what is unfinished.",
    "Protect your energy first.",
    "Change one repeating pattern.",
  ];
  const themes = [
    "changing direction",
    "clearer boundaries",
    "quiet confidence",
    "an overdue choice",
    "simplifying what feels heavy",
    "moving with intention",
  ];
  const cautions = [
    "Do not rush the honest part.",
    "Do not say yes too quickly.",
    "Question the old habit.",
    "Do not carry everything alone.",
    "Let the answer simplify.",
    "Do not let fear hurry you.",
  ];
  const step = nextSteps[hashString(seed + "step") % nextSteps.length];
  const theme = themes[hashString(seed + "theme") % themes.length];
  const caution = cautions[hashString(seed + "caution") % cautions.length];
  const templates = [
    () => `${first} sets the focus; ${second} adds the pressure. ${fourth} points to the next step: ${step}`,
    () => `This reading points to ${theme}. ${third} shows the adjustment; ${fourth} gives the direction.`,
    () => `${first} and ${second} show two sides of the situation. ${third} highlights ${keywordA}; ${step}`,
    () => `${keywordA} is the strongest thread here. ${fourth} shows how to respond, so ${caution}`,
    () => `This is about ${theme}, not a sudden breakthrough. Start with ${first}; ${step}`,
    () => `${second} and ${third} reveal the pattern: ${keywordB}. ${fourth} asks for care, so ${caution}`,
  ];

  return templates[hashString(seed + "template") % templates.length]();
}

function pickReadingKeywords(cardsForReading, seed, count) {
  const keywords = [];
  for (const card of cardsForReading) {
    if (Array.isArray(card.keywords)) {
      keywords.push(...card.keywords.filter((word) => typeof word === "string" && word.trim()));
    }
  }
  if (!keywords.length) {
    return [
      cardsForReading[hashString(seed + "fallbackA") % cardsForReading.length]?.concept || "change",
      cardsForReading[hashString(seed + "fallbackB") % cardsForReading.length]?.concept || "clarity",
    ];
  }
  const picked = [];
  for (let i = 0; i < count; i++) {
    picked.push(keywords[hashString(seed + "keyword" + i) % keywords.length].trim());
  }
  return picked;
}

function shuffleArray(items) {
  const shuffled = items.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function hashString(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
