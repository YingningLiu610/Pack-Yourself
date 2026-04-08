const socket = io();

let video;
let bodyPose;
let poses = [];
let latestPoses = [];
let connections = [];
let videoReady = false;

let scanLine = 0;
let targetMode = 1;

let hit = false;
let hitStart = 0;
let hitDuration = 4000;

const confidenceThreshold = 0.3;
const poseCompleteness = 0.9;

// 固定设计尺寸（内容层）
const designW = 360;
const designH = 640;

let worldScale = 1;
let worldOffsetX = 0;
let worldOffsetY = 0;
let uiScale = 1;

// 缓存静态层
let worldGridLayer;

// 降低更新负担
let poseFrameSkip = 3; // 每2帧更新一次显示用 poses
let lastPoseUpdateFrame = 0;

function preload() {
  bodyPose = ml5.bodyPose();
}

function setup() {
  pixelDensity(1);
  frameRate(30);
  createCanvas(windowWidth, windowHeight);

  video = createCapture(
    {
      video: {
        width: 640,
        height: 480,
        facingMode: "user"
      },
      audio: false
    },
    () => {
      videoReady = true;
    }
  );

  video.hide();

  bodyPose.detectStart(video, gotPoses);
  connections = bodyPose.getSkeleton();

  buildWorldGrid();
  pickNewTarget();
}

function buildWorldGrid() {
  worldGridLayer = createGraphics(designW, designH);
  worldGridLayer.pixelDensity(1);
  worldGridLayer.clear();

  worldGridLayer.stroke(255, 255, 255, 20);
  worldGridLayer.strokeWeight(1);

  for (let x = 0; x < designW; x += 40) {
    worldGridLayer.line(x, 0, x, designH);
  }

  for (let y = 0; y < designH; y += 40) {
    worldGridLayer.line(0, y, designW, y);
  }
}

function gotPoses(results) {
  latestPoses = results;
}

function draw() {
  background(18);

  worldScale = min(width / designW, height / designH);
  worldOffsetX = (width - designW * worldScale) / 2;
  worldOffsetY = (height - designH * worldScale) / 2;
  uiScale = worldScale;

  // 降低 pose 数据刷新的体感负担
  if (frameCount - lastPoseUpdateFrame >= poseFrameSkip) {
    poses = latestPoses;
    lastPoseUpdateFrame = frameCount;
  }

  if (videoReady) {
    drawVideoCover(video, 0, 0, width, height);
  } else {
    background(18);
  }

  drawOverlay();

  push();
  translate(worldOffsetX, worldOffsetY);
  scale(worldScale);
  drawScene();
  pop();

  // 屏幕级 HUD
  drawScreenScanLine();
  drawMeasurementFrameScreen();
  drawSystemLabelScreen();
}

function drawScene() {
  if (!videoReady) {
    fill(240);
    textAlign(CENTER, CENTER);
    textSize(18);
    text("initialising system...", designW / 2, designH / 2);
    return;
  }

  if (hit && millis() - hitStart > hitDuration) {
    hit = false;
    pickNewTarget();
  }

  image(worldGridLayer, 0, 0);

  const target = getTargetBox();
  const people = detectPeople();

  let success = false;

  // single mode
  if (targetMode === 1 || targetMode === 3) {
    for (let p of people) {
      if (isInside(p, target)) {
        success = true;
        drawBox(p, color(255, 200, 0), 3.2, "ONE UNIT");

        if (!hit) {
          captureAndSend(p.x, p.y, p.w, p.h);
          hit = true;
          hitStart = millis();
        }
        break;
      } else {
        drawBox(p, color(255), 2.4, "ONE UNIT");
      }
    }
  }

  // pair mode
  if (targetMode === 2) {
    if (people.length >= 2) {
      let p1 = people[0];
      let p2 = people[1];

      let pair = {
        x: min(p1.x, p2.x),
        y: min(p1.y, p2.y),
        w: max(p1.x + p1.w, p2.x + p2.w) - min(p1.x, p2.x),
        h: max(p1.y + p1.h, p2.y + p2.h) - min(p1.y, p2.y),
        cx: (min(p1.x, p2.x) + max(p1.x + p1.w, p2.x + p2.w)) / 2,
        cy: (min(p1.y, p2.y) + max(p1.y + p1.h, p2.y + p2.h)) / 2
      };

      let gapX = abs(p1.cx - p2.cx) - (p1.w / 2 + p2.w / 2);
      let closeEnough = gapX < 80;

      if (isInside(pair, target) && closeEnough) {
        success = true;
        drawBox(pair, color(255, 200, 0), 3.2, "TWO UNITS");

        if (!hit) {
          captureAndSend(pair.x, pair.y, pair.w, pair.h);
          hit = true;
          hitStart = millis();
        }
      } else {
        drawBox(pair, color(255), 3, "TWO UNITS");
      }
    }
  }

  drawTarget(target, success);
}

function getVideoWorldTransform() {
  let vw = video.elt.videoWidth;
  let vh = video.elt.videoHeight;

  if (!vw || !vh) {
    return {
      drawW: width,
      drawH: height,
      offsetX: 0,
      offsetY: 0
    };
  }

  let videoAspect = vw / vh;
  let boxAspect = width / height;

  let drawW, drawH, offsetX, offsetY;

  if (videoAspect > boxAspect) {
    drawH = height;
    drawW = height * videoAspect;
    offsetX = -(drawW - width) / 2;
    offsetY = 0;
  } else {
    drawW = width;
    drawH = width / videoAspect;
    offsetX = 0;
    offsetY = -(drawH - height) / 2;
  }

  return { drawW, drawH, offsetX, offsetY };
}

function screenToWorld(sx, sy) {
  return {
    x: (sx - worldOffsetX) / worldScale,
    y: (sy - worldOffsetY) / worldScale
  };
}

function detectPeople() {
  let people = [];
  let vt = getVideoWorldTransform();

  for (let pose of poses) {
    let minX = designW;
    let minY = designH;
    let maxX = 0;
    let maxY = 0;
    let valid = 0;

    for (let kp of pose.keypoints) {
      if (kp.confidence > confidenceThreshold) {
        valid++;

        let sx = map(kp.x, 0, video.elt.videoWidth, vt.offsetX, vt.offsetX + vt.drawW);
        let sy = map(kp.y, 0, video.elt.videoHeight, vt.offsetY, vt.offsetY + vt.drawH);

        let wp = screenToWorld(sx, sy);
        let x = wp.x;
        let y = wp.y;

        minX = min(minX, x);
        minY = min(minY, y);
        maxX = max(maxX, x);
        maxY = max(maxY, y);

        noStroke();
        fill(255, 200, 0);
        circle(x, y, 5.2);
      }
    }

    for (let c of connections) {
      let a = pose.keypoints[c[0]];
      let b = pose.keypoints[c[1]];

      if (a.confidence > confidenceThreshold && b.confidence > confidenceThreshold) {
        let asx = map(a.x, 0, video.elt.videoWidth, vt.offsetX, vt.offsetX + vt.drawW);
        let asy = map(a.y, 0, video.elt.videoHeight, vt.offsetY, vt.offsetY + vt.drawH);
        let bsx = map(b.x, 0, video.elt.videoWidth, vt.offsetX, vt.offsetX + vt.drawW);
        let bsy = map(b.y, 0, video.elt.videoHeight, vt.offsetY, vt.offsetY + vt.drawH);

        let aw = screenToWorld(asx, asy);
        let bw = screenToWorld(bsx, bsy);

        stroke(255);
        strokeWeight(1.5);
        line(aw.x, aw.y, bw.x, bw.y);
      }
    }

    let total = pose.keypoints.length;
    let required = floor(total * poseCompleteness);

    if (valid >= required) {
      let person = {
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
        cx: (minX + maxX) / 2,
        cy: (minY + maxY) / 2
      };

      people.push(person);
    }
  }

  return people;
}

function drawBox(box, c, w = 2, label = "") {
  stroke(c);
  strokeWeight(w);
  noFill();
  rect(box.x, box.y, box.w, box.h);

  let wValue = floor(box.w + random(-2, 2));
  let hValue = floor(box.h + random(-2, 2));

  noStroke();
  fill(c);
  textSize(11);

  textAlign(CENTER, BOTTOM);
  text(wValue + " px", box.x + box.w / 2, box.y - 8);

  textAlign(LEFT, CENTER);
  text(hValue + " px", box.x + box.w + 7, box.y + box.h / 2);

  if (label !== "") {
    let padX = 6;
    let tagH = 16;
    let tagW = textWidth(label) + padX * 2 + 4;

    fill(255, 200, 0);
    rect(box.x, box.y - 22, tagW, tagH);

    fill(0);
    textSize(11);
    textAlign(LEFT, CENTER);
    text(label, box.x + padX + 2, box.y - 14);
  }
}

function drawTarget(target, success) {
  let yellow = success ? color(255, 215, 60) : color(255, 200, 0);

  stroke(yellow);
  strokeWeight(success ? 3 : 2.2);
  noFill();
  rect(target.x, target.y, target.w, target.h);

  let corner = 14;
  strokeWeight(success ? 3 : 2.2);

  line(target.x, target.y, target.x + corner, target.y);
  line(target.x, target.y, target.x, target.y + corner);

  line(target.x + target.w, target.y, target.x + target.w - corner, target.y);
  line(target.x + target.w, target.y, target.x + target.w, target.y + corner);

  line(target.x, target.y + target.h, target.x + corner, target.y + target.h);
  line(target.x, target.y + target.h, target.x, target.y + target.h - corner);

  line(target.x + target.w, target.y + target.h, target.x + target.w - corner, target.y + target.h);
  line(target.x + target.w, target.y + target.h, target.x + target.w, target.y + target.h - corner);

  noStroke();
  fill(yellow);

  textSize(11);

  textAlign(CENTER, BOTTOM);
  text(floor(target.w) + " px", target.x + target.w / 2, target.y - 5);

  textAlign(LEFT, CENTER);
  text(floor(target.h) + " px", target.x + target.w + 6, target.y + target.h / 2);
}

function getTargetBox() {
  if (targetMode === 1) {
    return { x: designW / 2 - 160, y: designH / 2 - 40, w: 320, h: 350 };
  }

  if (targetMode === 2) {
    return { x: designW / 2 - 150, y: designH / 2 - 220, w: 300, h: 520 };
  }

  return { x: designW / 2 - 70, y: designH / 2 - 240, w: 140, h: 540 };
}

function isInside(box, target) {
  return (
    box.x > target.x &&
    box.y > target.y &&
    box.x + box.w < target.x + target.w &&
    box.y + box.h < target.y + target.h
  );
}

function drawOverlay() {
  fill(0, 170);
  noStroke();
  rect(0, 0, width, height);
}

function drawScreenScanLine() {
  let leftPad = 18 * uiScale;
  let rightPad = 18 * uiScale;

  stroke(255, 200, 0, 135);
  strokeWeight(max(2, 2.1 * uiScale));
  line(leftPad, scanLine, width - rightPad, scanLine);

  for (let i = 1; i <= 6; i++) {
    stroke(255, 200, 0, map(i, 1, 6, 24, 0));
    line(leftPad, scanLine - i * uiScale, width - rightPad, scanLine - i * uiScale);
  }

  scanLine += 2.8 * uiScale;
  if (scanLine > height - 18 * uiScale) {
    scanLine = 18 * uiScale;
  }
}

function drawSystemLabelScreen() {
  let required = targetMode === 2 ? 2 : 1;

  let x = 28 * uiScale;
  let y = 28 * uiScale;
  let w = 120 * uiScale;
  let h = 42 * uiScale;

  fill(255, 200, 0, 235);
  noStroke();
  rect(x, y, w, h);

  fill(0);
  textAlign(LEFT, TOP);

  textSize(10 * uiScale);
  text("UNITS REQUIRED", x + 8 * uiScale, y + 7 * uiScale);

  textSize(16 * uiScale);
  textAlign(LEFT, CENTER);
  text("1 / " + required, x + 8 * uiScale, y + 28 * uiScale);
}

function drawMeasurementFrameScreen() {
  let inset = 18 * uiScale;
  let tickInset = 6 * uiScale;
  let yellow = color(255, 200, 0, 110);

  stroke(yellow);
  strokeWeight(2.2 * uiScale);
  noFill();
  rect(inset, inset, width - inset * 2, height - inset * 2);

  for (let x = inset; x <= width - inset; x += 36 * uiScale) {
    line(x, inset, x, inset + tickInset);
    line(x, height - inset - tickInset, x, height - inset);
  }

  for (let y = inset; y <= height - inset; y += 36 * uiScale) {
    line(inset, y, inset + tickInset, y);
    line(width - inset - tickInset, y, width - inset, y);
  }

  stroke(255, 200, 0, 150);
  strokeWeight(3 * uiScale);

  let c = 18 * uiScale;

  line(inset, inset, inset + c, inset);
  line(inset, inset, inset, inset + c);

  line(width - inset, inset, width - inset - c, inset);
  line(width - inset, inset, width - inset, inset + c);

  line(inset, height - inset, inset + c, height - inset);
  line(inset, height - inset, inset, height - inset - c);

  line(width - inset, height - inset, width - inset - c, height - inset);
  line(width - inset, height - inset, width - inset, height - inset - c);
}

function drawVideoCover(vid, x, y, w, h) {
  let vw = vid.elt.videoWidth;
  let vh = vid.elt.videoHeight;

  if (!vw || !vh) return;

  let videoAspect = vw / vh;
  let boxAspect = w / h;

  let drawW, drawH, offsetX, offsetY;

  if (videoAspect > boxAspect) {
    drawH = h;
    drawW = h * videoAspect;
    offsetX = x - (drawW - w) / 2;
    offsetY = y;
  } else {
    drawW = w;
    drawH = w / videoAspect;
    offsetX = x;
    offsetY = y - (drawH - h) / 2;
  }

  image(vid, offsetX, offsetY, drawW, drawH);
}

function captureAndSend(x, y, w, h) {
  let captured = get(
    worldOffsetX + x * worldScale,
    worldOffsetY + y * worldScale,
    w * worldScale,
    h * worldScale
  );

  let square = createGraphics(256, 256);
  square.background(0);
  square.image(captured, 0, 0, 256, 256);

  let imgData = square.elt.toDataURL("image/png");

  socket.emit("capture", {
    imgData: imgData
  });
}

function pickNewTarget() {
  targetMode = floor(random(1, 4));
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  buildWorldGrid();
}