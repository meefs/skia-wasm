import Link from 'next/link';
import { appDescription, appName, docsRoute, githubUrl } from '@/lib/shared';

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <p className="rounded-full border px-3 py-1 text-xs font-medium text-fd-muted-foreground">
        Experimental: no stable API yet
      </p>
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{appName}</h1>
      <p className="max-w-xl text-lg text-fd-muted-foreground">{appDescription}</p>
      <p className="max-w-xl text-fd-muted-foreground">
        A scene is recorded once as an immutable program. Animating a frame is writing floats into
        a block of wasm memory and making one call.
      </p>
      <div className="flex flex-row flex-wrap justify-center gap-3">
        <Link
          href={docsRoute}
          className="rounded-full bg-fd-primary px-5 py-2 text-sm font-medium text-fd-primary-foreground"
        >
          Read the docs
        </Link>
        <a
          href={githubUrl}
          rel="noreferrer noopener"
          target="_blank"
          className="rounded-full border px-5 py-2 text-sm font-medium"
        >
          GitHub
        </a>
      </div>
    </main>
  );
}
