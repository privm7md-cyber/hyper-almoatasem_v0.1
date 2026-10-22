// Phase-11 header search island ("use client": interactive submit only).
// Submits to the real minimal /search results page (no autocomplete endpoint exists).
//
// Fixed in this phase:
//   * the input id was hardcoded ("store-search"), so the /search page — which
//     renders a SECOND search box — produced two elements with the same id and
//     two search landmarks with the same name; the id is now unique per box;
//   * submitting a one-character query did NOTHING at all (the handler
//     returned silently) — it now says what is missing.

"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Search } from "lucide-react";

export function SearchBox({
  initial = "",
  label = "البحث في المتجر",
  hint = "ابحث عن منتج",
}: {
  initial?: string;
  /** The accessible name of the search landmark (unique per instance). */
  label?: string;
  /** The visible / screen-reader label of the field. */
  hint?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [note, setNote] = useState<string | null>(null);
  const inputId = useId();
  const noteId = useId();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const q = value.trim();
    if (q.length < 2) {
      setNote("اكتب كلمتين على الأقل للبحث.");
      return;
    }
    setNote(null);
    router.push(`/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <form
      role="search"
      aria-label={label}
      onSubmit={submit}
      className="flex min-w-0 flex-wrap gap-x-2 gap-y-1"
    >
      <div className="flex min-w-0 flex-1 gap-2">
        <label htmlFor={inputId} className="sr-only">
          {hint}
        </label>
        <input
          id={inputId}
          type="search"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (note) setNote(null);
          }}
          placeholder="ابحث عن منتج…"
          minLength={2}
          maxLength={120}
          aria-describedby={note ? noteId : undefined}
          className="min-h-[44px] w-full min-w-0 rounded-control border border-line bg-white px-3 text-base text-ink transition-colors duration-200 hover:border-line-strong focus:border-brand"
        />
        <button
          type="submit"
          aria-label="بحث"
          className="vxp-primary-btn inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-control bg-brand px-4 font-semibold text-white md:px-5"
        >
          <Search size={18} aria-hidden="true" />
          <span className="hidden sm:inline">بحث</span>
        </button>
      </div>
      {note ? (
        <p id={noteId} role="status" className="w-full text-xs font-semibold text-error">
          {note}
        </p>
      ) : null}
    </form>
  );
}
