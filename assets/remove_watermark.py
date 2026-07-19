import sys, traceback
from PIL import Image, ImageFilter, ImageDraw
print("import ok", flush=True)
src = r"E:\work buddy test\爱合师AI辅导员\assets\gate.jpg"
img = Image.open(src).convert("RGB")
print("open ok", img.size, flush=True)
blur = img.filter(ImageFilter.GaussianBlur(10))
print("blur ok", flush=True)
mask = Image.new("L", img.size, 0)
d = ImageDraw.Draw(mask)
H = img.size[1]; W = img.size[0]
d.rectangle([0, int(H * 0.90), W, H], fill=255)
d.rectangle([int(W * 0.55), int(H * 0.70), W, int(H * 0.90)], fill=255)
print("mask ok", flush=True)
out = Image.composite(blur, img, mask)
print("composite ok", flush=True)
dst = r"E:\work buddy test\爱合师AI辅导员\assets\gate_clean.jpg"
out.save(dst, "JPEG", quality=88)
print("saved", dst, flush=True)
