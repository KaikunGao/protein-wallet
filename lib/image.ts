"use client";

// Client-side downscale to <= maxPx on the long edge, JPEG. Keeps upload small
// and well under the API's image limits. Returns a data URL (the route strips it).
export async function compressImage(
  file: File,
  maxPx = 1024,
  quality = 0.8,
): Promise<string> {
  const source = await decode(file);
  const scale = Math.min(1, maxPx / Math.max(source.width, source.height));
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持图片处理");
  ctx.drawImage(source.el, 0, 0, w, h);
  source.release();
  return canvas.toDataURL("image/jpeg", quality);
}

interface Decoded {
  el: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decode(file: File): Promise<Decoded> {
  // Prefer createImageBitmap (honours EXIF orientation); fall back to <img>.
  if ("createImageBitmap" in window) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { el: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() };
    } catch {
      /* fall through */
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("图片无法读取"));
    img.src = url;
  });
  return {
    el: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
    release: () => URL.revokeObjectURL(url),
  };
}
