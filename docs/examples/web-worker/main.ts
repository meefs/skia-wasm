// The page hands its canvas over to a worker, which does all the drawing.
const canvas = document.querySelector("canvas")!;
const offscreen = canvas.transferControlToOffscreen();
const worker = new Worker(new URL("./worker.ts", import.meta.url), {
  type: "module",
});
worker.postMessage({ canvas: offscreen }, [offscreen]);

// Input stays on the page and reaches the worker as plain numbers.
canvas.addEventListener("pointermove", (event) => {
  worker.postMessage({ x: event.offsetX, y: event.offsetY });
});
