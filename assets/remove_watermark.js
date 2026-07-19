const { Jimp } = require('jimp');
(async () => {
  const img = await Jimp.read('gate.jpg');
  const W = img.bitmap.width, H = img.bitmap.height;
  const delta = Math.round(H * 0.14); // 从上方 14% 高度取干净像素覆盖
  const regions = [
    [0, Math.floor(H * 0.86), W, H - Math.floor(H * 0.86)],                                 // 底部整条
    [Math.floor(W * 0.50), Math.floor(H * 0.66), W - Math.floor(W * 0.50), Math.floor(H * 0.20)] // 右下角
  ];
  for (const [rx, ry, rw, rh] of regions) {
    img.scan(rx, ry, rw, rh, function (x, y, idx) {
      let sy = y - delta;
      if (sy < 0) sy = 0;
      const c = img.getPixelColor(x, sy);
      this.setPixelColor(c, x, y);
    });
  }
  await img.quality(88).writeAsync('gate_clean.jpg');
  console.log('watermark covered -> gate_clean.jpg', W, H);
})().catch(e => { console.error(e); process.exit(1); });
