"use client";

import { Button } from "@/components/ui/button";

export default function ConsoleError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-start justify-center gap-4 px-6">
      <p className="font-display text-4xl italic">The console failed to load.</p>
      <p className="max-w-md text-sm text-muted-foreground">
        The shop ledger could not be read. Retry, and if it keeps failing, check that this
        machine can write a `.data` folder.
      </p>
      <Button type="button" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
