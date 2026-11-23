'use client';
import { useEffect, useRef, useState } from 'react';
import { examplesRoute } from '@/lib/shared';

// The size of the canvas the examples are written for.
const SIZE = 512;

/**
 * The live preview of an example: the page that `scripts/examples.mjs` builds
 * for it, in an iframe. An iframe gives every example its own module, device
 * and page, and stops it when the reader leaves.
 */
export function Example({
  name,
  manual = false,
}: {
  name: string;
  /** Wait for a click before running, for an example that asks for a permission. */
  manual?: boolean;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [started, setStarted] = useState(!manual);
  // Changing the key of the iframe loads the example again.
  const [run, setRun] = useState(0);
  const url = `${examplesRoute}/${name}.html`;

  // The example draws at 512 by 512. On a narrower screen the whole iframe is
  // scaled down, so that pointer positions inside it stay in canvas pixels.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / SIZE);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <figure className="not-prose my-6">
      <div
        ref={frame}
        // A ring, not a border: a border would take two pixels off the preview.
        className="relative w-full overflow-hidden rounded-xl bg-white ring-1 ring-fd-border"
        style={{ maxWidth: SIZE, aspectRatio: '1' }}
      >
        {started ? (
          <iframe
            key={run}
            src={url}
            title={`${name}: live preview`}
            allow="camera"
            width={SIZE}
            height={SIZE}
            className="block origin-top-left border-0"
            style={{ transform: `scale(${scale})` }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setStarted(true)}
            className="absolute inset-0 flex items-center justify-center bg-fd-card text-sm font-medium text-fd-card-foreground"
          >
            <span className="rounded-full bg-fd-primary px-5 py-2 text-fd-primary-foreground">
              Run the example
            </span>
          </button>
        )}
      </div>
      <figcaption className="mt-2 flex flex-row gap-4 text-sm text-fd-muted-foreground">
        {started && (
          <button type="button" onClick={() => setRun((count) => count + 1)} className="underline">
            Restart
          </button>
        )}
        <a href={url} target="_blank" rel="noreferrer noopener" className="underline">
          Open in a new tab
        </a>
      </figcaption>
    </figure>
  );
}
