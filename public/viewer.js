const socket = io();

let blocks = [];
let cols = 4;
let rows = 5;

let cellSize = 80;
let gridW = 0;
let gridH = 0;
let gridX = 0;
let gridY = 0;

let startY = 0;
let clearing = false;

let hudScale = 1;

function setup() {
  createCanvas(windowWidth, windowHeight);

  // 去掉页面默认边距和滚动条
  document.body.style.margin = "0";
  document.body.style.padding = "0";
  document.body.style.overflow = "hidden";
  document.documentElement.style.overflow = "hidden";

  recalcLayout();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  recalcLayout();
}

function recalcLayout() {
  // HUD 和外框按屏幕缩放
  hudScale = min(width / 360, height / 640);

  // 给左上角 label 和四周边框预留空间
  let topMargin = 92 * hudScale;
  let bottomMargin = 34 * hudScale;
  let sideMargin = 22 * hudScale;

  // 让中间 4x5 方格尽量大，但仍完整放进屏幕
  let availableW = width - sideMargin * 2;
  let availableH = height - topMargin - bottomMargin;

  cellSize = floor(min(availableW / cols, availableH / rows));

  // 防止太小
  cellSize = max(cellSize, 40);

  gridW = cols * cellSize;
  gridH = rows * cellSize;

  gridX = (width - gridW) / 2;
  gridY = topMargin + (availableH - gridH) / 2;

  startY = -cellSize;
}

socket.on("capture", (data) => {
  if (clearing) return;
  if (allColumnsFull()) return;

  loadImage(data.imgData, (loadedImg) => {
    let compressedImg = makeCompressedUnit(loadedImg);
    addImageBlock(compressedImg);
  });
});

function draw() {
  background(18);

  drawOverlay();
  drawIndustrialBackground();
  drawGrid();

  if (clearing) {
    updateClearing();
  } else {
    updateBlocks();

    if (allColumnsFull() && allBlocksSettled()) {
      clearing = true;
    }
  }

  drawBlocks();
  drawSystemLabelScreen();
  drawMeasurementFrameScreen();
}

function drawOverlay() {
  fill(0, 170);
  noStroke();
  rect(0, 0, width, height);
}

function drawIndustrialBackground() {
  // 背景大网格也跟屏幕变大一点
  let bgStep = max(48 * hudScale, 36);

  stroke(255, 255, 255, 14);
  strokeWeight(max(1, 1.1 * hudScale));

  for (let x = 0; x < width; x += bgStep) {
    line(x, 0, x, height);
  }

  for (let y = 0; y < height; y += bgStep) {
    line(0, y, width, y);
  }
}

function drawGrid() {
  stroke(255, 200, 0, 95);
  strokeWeight(max(1.4, 1.6 * hudScale));
  noFill();

  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      let x = gridX + col * cellSize;
      let y = gridY + row * cellSize;
      rect(x, y, cellSize, cellSize);
    }
  }
}

function updateBlocks() {
  let speed = max(2.4, 2.8 * hudScale);

  for (let b of blocks) {
    if (b.y < b.targetY) {
      b.y += speed;
      if (b.y > b.targetY) {
        b.y = b.targetY;
      }
    }
  }
}

function drawBlocks() {
  for (let i = 0; i < blocks.length; i++) {
    let b = blocks[i];

    if (b.img) {
      imageMode(CORNER);
      image(b.img, b.x, b.y, cellSize, cellSize);

      // 单元边框
      stroke(255, 200, 0, 180);
      strokeWeight(max(1.4, 1.5 * hudScale));
      noFill();
      rect(b.x, b.y, cellSize, cellSize);

      // 左上角小编号
      let tagW = max(22, 24 * hudScale);
      let tagH = max(12, 13 * hudScale);

      fill(255, 200, 0);
      noStroke();
      rect(b.x, b.y, tagW, tagH);

      fill(0);
      textSize(max(8, 8.5 * hudScale));
      textAlign(CENTER, CENTER);
      text(i + 1, b.x + tagW / 2, b.y + tagH / 2);

      // 底部轻微数据条
      stroke(255, 200, 0, 85);
      strokeWeight(max(1, 1.1 * hudScale));
      line(b.x + 4, b.y + cellSize - 5, b.x + cellSize - 4, b.y + cellSize - 5);
    }
  }
}

function addImageBlock(img) {
  let counts = [];
  for (let col = 0; col < cols; col++) {
    counts[col] = countBlocksInCol(col);
  }

  let minCount = rows;
  for (let col = 0; col < cols; col++) {
    if (counts[col] < minCount) {
      minCount = counts[col];
    }
  }

  if (minCount >= rows) return;

  let candidateCols = [];
  for (let col = 0; col < cols; col++) {
    if (counts[col] === minCount) {
      candidateCols.push(col);
    }
  }

  let col = random(candidateCols);

  let x = gridX + col * cellSize;
  let targetY = gridY + (rows - 1 - counts[col]) * cellSize;

  blocks.push({
    col: col,
    x: x,
    y: startY,
    targetY: targetY,
    img: img
  });
}

function countBlocksInCol(col) {
  let count = 0;
  for (let b of blocks) {
    if (b.col === col) {
      count++;
    }
  }
  return count;
}

function allColumnsFull() {
  for (let col = 0; col < cols; col++) {
    if (countBlocksInCol(col) < rows) {
      return false;
    }
  }
  return true;
}

function allBlocksSettled() {
  for (let b of blocks) {
    if (b.y < b.targetY) {
      return false;
    }
  }
  return true;
}

function updateClearing() {
  let speed = max(2.8, 3.1 * hudScale);

  for (let b of blocks) {
    b.y += speed;
    b.targetY += speed;
  }

  let allOut = true;
  for (let b of blocks) {
    if (b.y < height) {
      allOut = false;
      break;
    }
  }

  if (allOut) {
    blocks = [];
    clearing = false;
  }
}

function drawSystemLabelScreen() {
  let capacity = cols * rows;

  let x = 18 * hudScale;
  let y = 18 * hudScale;
  let w = 128 * hudScale;
  let h = 44 * hudScale;

  fill(255, 200, 0, 235);
  noStroke();
  rect(x, y, w, h);

  fill(0);
  textAlign(LEFT, TOP);

  textSize(10 * hudScale);
  text("UNITS LOADED", x + 8 * hudScale, y + 7 * hudScale);

  textSize(16 * hudScale);
  textAlign(LEFT, CENTER);
  text(blocks.length + " / " + capacity, x + 8 * hudScale, y + 29 * hudScale);
}

function drawMeasurementFrameScreen() {
  let yellow = color(255, 200, 0, 110);

  stroke(yellow);
  strokeWeight(max(2, 2.2 * hudScale));
  noFill();
  rect(7 * hudScale, 7 * hudScale, width - 14 * hudScale, height - 14 * hudScale);

  for (let x = 7 * hudScale; x <= width - 7 * hudScale; x += 36 * hudScale) {
    line(x, 7 * hudScale, x, 13 * hudScale);
    line(x, height - 13 * hudScale, x, height - 7 * hudScale);
  }

  for (let y = 7 * hudScale; y <= height - 7 * hudScale; y += 36 * hudScale) {
    line(7 * hudScale, y, 13 * hudScale, y);
    line(width - 13 * hudScale, y, width - 7 * hudScale, y);
  }

  stroke(255, 200, 0, 150);
  strokeWeight(max(3, 3.2 * hudScale));

  let c = 18 * hudScale;

  line(7 * hudScale, 7 * hudScale, 7 * hudScale + c, 7 * hudScale);
  line(7 * hudScale, 7 * hudScale, 7 * hudScale, 7 * hudScale + c);

  line(width - 7 * hudScale, 7 * hudScale, width - 7 * hudScale - c, 7 * hudScale);
  line(width - 7 * hudScale, 7 * hudScale, width - 7 * hudScale, 7 * hudScale + c);

  line(7 * hudScale, height - 7 * hudScale, 7 * hudScale + c, height - 7 * hudScale);
  line(7 * hudScale, height - 7 * hudScale, 7 * hudScale, height - 7 * hudScale - c);

  line(width - 7 * hudScale, height - 7 * hudScale, width - 7 * hudScale - c, height - 7 * hudScale);
  line(width - 7 * hudScale, height - 7 * hudScale, width - 7 * hudScale, height - 7 * hudScale - c);
}

// 压缩单元：保持 1:1，但做低分辨率再放大
function makeCompressedUnit(img) {
  let unit = createGraphics(cellSize, cellSize);
  unit.pixelDensity(1);
  unit.noSmooth();

  let lowRes = createGraphics(8, 8);
  lowRes.pixelDensity(1);
  lowRes.noSmooth();

  lowRes.image(img, 0, 0, 8, 8);
  unit.image(lowRes, 0, 0, cellSize, cellSize);

  unit.noStroke();
  unit.fill(0, 35);
  unit.rect(0, 0, cellSize, cellSize);

  for (let y = 0; y < cellSize; y += max(6, floor(cellSize / 14))) {
    unit.stroke(255, 200, 0, random(15, 35));
    unit.line(0, y, cellSize, y);
  }

  unit.noStroke();
  unit.fill(255, 200, 0, 180);
  unit.rect(cellSize - max(8, cellSize * 0.1), 0, max(8, cellSize * 0.1), max(8, cellSize * 0.1));

  return unit;
}