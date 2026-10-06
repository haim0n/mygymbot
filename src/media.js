import { FRAME_COUNT, FRAME_MAX_SIDE, SCREENSHOT_TILE } from "./config.js";

export function toJpegBase64(source, width, height) {
  const scale = Math.min(1, FRAME_MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.75).split(",")[1];
}

export function waitFor(element, eventName) {
  return new Promise((resolve, reject) => {
    element.addEventListener(eventName, resolve, { once: true });
    element.addEventListener("error", () => reject(new Error("This file format can't be read here.")), { once: true });
  });
}

// The AI reads images, not video, so we sample evenly spaced frames from the set.
export async function videoToFrames(file) {
  const src = URL.createObjectURL(file);
  try {
    const video = Object.assign(document.createElement("video"), { muted: true, playsInline: true, preload: "auto", src });
    await waitFor(video, "loadedmetadata");
    if (!Number.isFinite(video.duration)) throw new Error("Couldn't read the video length. Try a different recording.");
    const frames = [];
    for (let i = 0; i < FRAME_COUNT; i++) {
      const seeked = waitFor(video, "seeked");
      video.currentTime = (video.duration * (i + 0.5)) / FRAME_COUNT;
      await seeked;
      frames.push(toJpegBase64(video, video.videoWidth, video.videoHeight));
    }
    return frames;
  } finally {
    URL.revokeObjectURL(src);
  }
}

export async function withImage(file, draw) {
  const image = await createImageBitmap(file);
  try {
    return draw(image, { width: image.width, height: image.height });
  } finally {
    image.close(); // frees the bitmap's memory
  }
}

export const imageToFrame = (file) => withImage(file, (image, size) => toJpegBase64(image, size.width, size.height));

// Keeps the screenshot at a readable width and cuts it top to bottom into overlapping slices,
// instead of shrinking a tall scroll capture until the text is unreadable.
export function screenshotToTiles(file) {
  return withImage(file, (image, size) => {
    const { width: maxWidth, height: tileHeight, overlap, maxPerScreenshot } = SCREENSHOT_TILE;
    const scale = Math.min(1, maxWidth / size.width);
    const width = Math.round(size.width * scale);
    const height = Math.round(size.height * scale);
    const tiles = [];
    for (let top = 0; tiles.length < maxPerScreenshot; top += tileHeight - overlap) {
      const sliceHeight = Math.min(tileHeight, height - top);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = sliceHeight;
      canvas.getContext("2d").drawImage(image, 0, top / scale, size.width, sliceHeight / scale, 0, 0, width, sliceHeight);
      tiles.push(canvas.toDataURL("image/jpeg", 0.85).split(",")[1]);
      if (top + sliceHeight >= height) break;
    }
    return tiles;
  });
}

export async function filesToMedia(files) {
  const video = files.find((file) => file.type.startsWith("video/"));
  if (video) return { kind: "video", frames: await videoToFrames(video) };
  const images = files.filter((file) => file.type.startsWith("image/")).slice(0, FRAME_COUNT);
  if (!images.length) throw new Error("Choose a video or photo file.");
  return { kind: "photos", frames: await Promise.all(images.map(imageToFrame)) };
}
