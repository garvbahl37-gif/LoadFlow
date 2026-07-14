"use client";

import { useEffect, useState } from "react";

/** Theme lives in localStorage; the no-flash script in the root layout applies it
    before paint, so this component only has to keep the two in sync. */
export function ThemeToggle() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("lf-theme", next ? "dark" : "light");
    } catch {
      // Private mode / storage disabled — the toggle still works for this session.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
    >
      {dark ? (
        <svg viewBox="0 0 16 16" className="h-4 w-4 fill-current" aria-hidden>
          <path d="M8 1.5a.75.75 0 0 1 .75.75v1a.75.75 0 0 1-1.5 0v-1A.75.75 0 0 1 8 1.5Zm0 10a.75.75 0 0 1 .75.75v1a.75.75 0 0 1-1.5 0v-1A.75.75 0 0 1 8 11.5ZM14.5 8a.75.75 0 0 1-.75.75h-1a.75.75 0 0 1 0-1.5h1a.75.75 0 0 1 .75.75Zm-10 0a.75.75 0 0 1-.75.75h-1a.75.75 0 0 1 0-1.5h1A.75.75 0 0 1 4.5 8Zm8.07-4.57a.75.75 0 0 1 0 1.06l-.7.71a.75.75 0 1 1-1.07-1.06l.71-.71a.75.75 0 0 1 1.06 0ZM5.2 10.8a.75.75 0 0 1 0 1.06l-.71.71a.75.75 0 0 1-1.06-1.06l.7-.71a.75.75 0 0 1 1.07 0Zm7.37 1.77a.75.75 0 0 1-1.06 0l-.71-.71a.75.75 0 0 1 1.06-1.06l.71.7a.75.75 0 0 1 0 1.07ZM5.2 5.2a.75.75 0 0 1-1.06 0l-.71-.71a.75.75 0 0 1 1.06-1.06l.71.7A.75.75 0 0 1 5.2 5.2ZM8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" className="h-4 w-4 fill-current" aria-hidden>
          <path d="M13.3 9.6A5.6 5.6 0 0 1 6.4 2.7a.75.75 0 0 0-1-.9 6.9 6.9 0 1 0 8.8 8.8.75.75 0 0 0-.9-1Z" />
        </svg>
      )}
    </button>
  );
}
