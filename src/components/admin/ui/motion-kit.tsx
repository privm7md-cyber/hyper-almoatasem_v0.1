// ADMIN MOTION KIT — the Motion (motion/react) runtime, loaded on demand.
//
// Motion is NOT part of any admin page's initial payload. The drawer, the
// confirmation gate and the mobile navigation overlay all reach this module
// through next/dynamic, so the animation runtime is fetched after the page
// is already interactive and the CRUD pages keep a light first load.
//
// Each piece wraps itself in its own LazyMotion provider: `m.*` throws in
// strict mode without an ancestor provider, and a self-contained wrapper
// lets the kit be mounted anywhere without the admin layout paying for it.

"use client";

import { useEffect, useEffectEvent, useId, useRef, type ReactNode, type RefObject } from "react";
import { AnimatePresence, LazyMotion, MotionConfig, domAnimation, m, useReducedMotion } from "motion/react";
import { Check, X } from "lucide-react";
import { MOTION_DURATIONS_SEC, MOTION_SPRINGS } from "@/lib/motion-tokens";

function MotionScope({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user"><LazyMotion features={domAnimation} strict>{children}</LazyMotion></MotionConfig>;
}

/* ---------------------------------------------------------------- drawer */

interface DrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

// Own the modal lifecycle inside presence, not in the always-mounted public
// wrapper: closing must not release the background until both exits finish.
function DrawerContent({ title, onClose, children, footer }: Omit<DrawerProps, "open">) {
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  useModalLifecycle(panelRef, onClose);

  return (
    <m.div
      className="adm-drawer-backdrop"
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reducedMotion ? 0 : MOTION_DURATIONS_SEC.fast }}
    >
      <button type="button" tabIndex={-1} aria-hidden="true" onClick={onClose} className="adm-nav-dismiss" />
      <m.div
        ref={panelRef}
        id={panelId}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="adm-drawer"
        initial={reducedMotion ? false : { x: "100%", opacity: 0.35 }}
        animate={{ x: 0, opacity: 1 }}
        exit={reducedMotion ? { x: 0, opacity: 1 } : { x: "100%", opacity: 0.35 }}
        transition={reducedMotion ? { duration: 0 } : MOTION_SPRINGS.drawer}
      >
        <div className="adm-drawer-head">
          <h2 className="adm-drawer-title">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="adm-btn adm-btn--secondary adm-btn--sm"
            aria-label="إغلاق"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="adm-drawer-body">{children}</div>
        {footer ? <div className="adm-drawer-foot">{footer}</div> : null}
      </m.div>
    </m.div>
  );
}

export function MotionDrawer({ open, ...props }: DrawerProps) {
  return (
    <MotionScope>
      <AnimatePresence>
        {open ? <DrawerContent key="form-drawer" {...props} /> : null}
      </AnimatePresence>
    </MotionScope>
  );
}

/* ------------------------------------------------------------- confirm */

/**
 * The confirmation gate for anything that changes the store's data. The
 * action button states exactly what will happen — the operator never presses
 * a button whose effect is a surprise.
 */
export function MotionConfirm({
  open,
  question,
  confirmLabel,
  variant,
  onConfirm,
  onCancel,
  onExitComplete,
}: {
  open: boolean;
  question: string;
  confirmLabel: string;
  variant: "primary" | "secondary" | "ghost" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
  onExitComplete?: () => void;
}) {
  const reducedMotion = useReducedMotion();

  return (
    <MotionScope>
      <AnimatePresence onExitComplete={onExitComplete}>
        {open ? (
          <m.div
            key="ask"
            className="adm-note adm-note--danger adm-confirm-row"
            initial={reducedMotion ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: reducedMotion ? 0 : MOTION_DURATIONS_SEC.fast }}
          >
            <span className="adm-confirm-text">{question}</span>
            <span className="adm-btn-row">
              <button
                type="button"
                className={`adm-btn adm-btn--${variant} adm-btn--sm`}
                onClick={onConfirm}
              >
                <Check size={15} aria-hidden="true" />
                {confirmLabel}
              </button>
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={onCancel}>
                رجوع
              </button>
            </span>
          </m.div>
        ) : null}
      </AnimatePresence>
    </MotionScope>
  );
}

/* ------------------------------------------------------------ nav overlay */

interface NavOverlayProps {
  open: boolean;
  panelId: string;
  onClose: () => void;
  children: ReactNode;
  backgroundRef?: RefObject<HTMLElement | null>;
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

function isVisible(element: HTMLElement) {
  if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = window.getComputedStyle(ancestor);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
  }
  return true;
}

// Both content components keep this hook mounted for the entire presence
// lifetime. Callback updates (e.g. a form edit) must not restart the lifecycle.
function useModalLifecycle(
  panelRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  backgroundRef?: RefObject<HTMLElement | null>,
  restoreFocusRef?: RefObject<HTMLElement | null>,
) {
  const close = useEffectEvent(() => onClose());
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const returnFocus = restoreFocusRef?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    // Preserve individual overflow declarations and their !important priority.
    const previousOverflow = Array.from(document.body.style)
      .filter((property) => /^(overflow|overflow-x|overflow-y)$/.test(property))
      .map((property) => [property, document.body.style.getPropertyValue(property), document.body.style.getPropertyPriority(property)] as const);
    const inertElements = new Map<HTMLElement, string | null>();
    const makeInert = (element: HTMLElement) => {
      if (inertElements.has(element) || element.contains(panel)) return;
      inertElements.set(element, element.getAttribute("inert"));
      element.setAttribute("inert", "");
    };
    if (backgroundRef?.current) makeInert(backgroundRef.current);
    // The backdrop is the modal root. Inert sibling branches up to body, not
    // that root or the dialog's ancestors (the form drawer is nested in main).
    let branch: HTMLElement | null = panel.parentElement;
    while (branch && branch !== document.body) {
      const parent: HTMLElement | null = branch.parentElement;
      if (!parent) break;
      for (const sibling of parent.children) {
        if (sibling !== branch && sibling instanceof HTMLElement && !["SCRIPT", "STYLE", "LINK"].includes(sibling.tagName)) makeInert(sibling);
      }
      branch = parent;
    }
    document.body.style.setProperty("overflow", "hidden");
    const focusable = () => Array.from(panel.querySelectorAll<HTMLElement>(
      'a[href], area[href], button, input, select, textarea, summary, [contenteditable="true"], [tabindex]',
    )).filter((element) => element.tabIndex >= 0 && !element.matches(':disabled, input[type="hidden"]') && isVisible(element));
    const focusFirst = () => (focusable()[0] ?? panel).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (event.key === "Tab") {
        const targets = focusable();
        const first = targets[0] ?? panel;
        const last = targets.at(-1) ?? panel;
        const active = document.activeElement;
        if (!targets.includes(active as HTMLElement) || (event.shiftKey ? active === first : active === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !panel.contains(event.target)) focusFirst();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocus, true);
    focusFirst();
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocus, true);
      document.body.style.removeProperty("overflow");
      for (const [property, value, priority] of previousOverflow) document.body.style.setProperty(property, value, priority);
      for (const [element, value] of inertElements) {
        if (value === null) element.removeAttribute("inert");
        else element.setAttribute("inert", value);
      }
      // On a desktop resize or removal, the original trigger can be hidden.
      (returnFocus && !returnFocus.matches(":disabled") && isVisible(returnFocus) ? returnFocus : document.getElementById("main"))?.focus();
    };
  }, [panelRef, backgroundRef, restoreFocusRef]);
}

// Mounted for the entire presence lifetime: background inertness and focus
// trapping remain in place during exit, then the original focus is restored.
function NavOverlayContent({ panelId, onClose, children, backgroundRef, restoreFocusRef }: Omit<NavOverlayProps, "open">) {
  const panelRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  useModalLifecycle(panelRef, onClose, backgroundRef, restoreFocusRef);

  return (
    <m.div
      className="adm-drawer-backdrop"
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reducedMotion ? 0 : MOTION_DURATIONS_SEC.fast }}
    >
      <button type="button" tabIndex={-1} aria-hidden="true" onClick={onClose} className="adm-nav-dismiss" />
      <m.div
        ref={panelRef}
        id={panelId}
        role="dialog"
        aria-modal="true"
        aria-label="أقسام لوحة الإدارة"
        tabIndex={-1}
        className="adm-drawer adm-nav-drawer"
        initial={reducedMotion ? false : { x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: reducedMotion ? 0 : "100%" }}
        transition={reducedMotion ? { duration: 0 } : MOTION_SPRINGS.drawer}
      >
        <div className="adm-drawer-head adm-nav-drawer-head">
          <h2>أقسام لوحة الإدارة</h2>
          <button type="button" onClick={onClose} className="adm-btn adm-btn--secondary adm-rail-logout" aria-label="إغلاق القائمة">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="adm-drawer-body adm-nav-drawer-body">{children}</div>
      </m.div>
    </m.div>
  );
}

/** The mobile navigation drawer; imported lazily by the shell only on mobile. */
export function MotionNavOverlay({ open, ...props }: NavOverlayProps) {
  return (
    <MotionScope>
      <AnimatePresence>
        {open ? <NavOverlayContent key="nav-drawer" {...props} /> : null}
      </AnimatePresence>
    </MotionScope>
  );
}
