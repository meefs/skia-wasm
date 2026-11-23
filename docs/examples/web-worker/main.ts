// The page hands its canvas over to a worker, which does all the drawing.
const canvas = document.querySelector("canvas")!;
// A worker cannot see the screen: the page pins the size of the canvas and
// tells the worker how many pixels a unit should take.
canvas.style.width = `${canvas.width}px`;
canvas.style.height = `${canvas.height}px`;
const offscreen = canvas.transferControlToOffscreen();
const worker = new Worker(new URL("./worker.ts", import.meta.url), {
  type: "module",
});
worker.postMessage({ canvas: offscreen, pixelRatio: devicePixelRatio }, [
  offscreen,
]);

// Input stays on the page and reaches the worker as plain numbers.
canvas.addEventListener("pointermove", (event) => {
  worker.postMessage({ x: event.offsetX, y: event.offsetY });
});
