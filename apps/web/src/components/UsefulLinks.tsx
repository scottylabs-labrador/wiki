import { sourceCatalog } from "@wiki/common";
import { Menu, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { useSession } from "@/lib/authClient";

/** The Sources the agent answers from, as links a member can open. */
export function UsefulLinks() {
  const { data: auth } = useSession();
  if (!auth?.user) {
    return null;
  }

  return (
    <aside
      aria-labelledby="useful-links-heading"
      className="hidden w-56 shrink-0 flex-col gap-3 border-r border-border bg-muted/40 p-4 md:flex"
    >
      <h2 id="useful-links-heading" className="text-base font-semibold">
        Useful Links
      </h2>
      <UsefulLinksItems />
    </aside>
  );
}

/** Hamburger that opens Useful Links on a small screen, where the left bar is hidden. */
export function UsefulLinksMenu() {
  const { data: auth } = useSession();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const panelId = useId();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    menuButtonRef.current?.focus();
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    closeButtonRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        menuButtonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!auth?.user) {
    return null;
  }

  return (
    <div className="md:hidden">
      <button
        ref={menuButtonRef}
        type="button"
        aria-label="Useful Links"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(true)}
        className="rounded-md p-2 hover:bg-white/10"
      >
        <Menu className="size-5" aria-hidden />
      </button>
      {open && (
        <div className="fixed inset-0 z-60 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={close} />
          <aside
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="absolute inset-y-0 left-0 flex w-64 flex-col gap-3 bg-background p-4 text-foreground shadow-xl"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 id={titleId} className="text-base font-semibold">
                Useful Links
              </h2>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Close useful links"
                onClick={close}
                className="rounded-md p-1 text-foreground hover:bg-muted"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <UsefulLinksItems />
          </aside>
        </div>
      )}
    </div>
  );
}

function UsefulLinksItems() {
  return (
    <>
      <ul className="list-disc space-y-2 pl-5">
        {sourceCatalog.map((source) => (
          <li key={source.id}>
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-blue-600 underline underline-offset-4 dark:text-blue-400"
            >
              {source.title}
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-auto text-xs text-muted-foreground">
        <a
          href="https://go.scottylabs.org/slack"
          target="_blank"
          rel="noreferrer"
          className="text-blue-600 underline underline-offset-4 dark:text-blue-400"
        >
          Slack
        </a>{" "}
        Yuxiang Huang if you have any questions or feedback.
      </p>
    </>
  );
}
