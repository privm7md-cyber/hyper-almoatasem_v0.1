// AdminScene gatekeeper — the ONLY entry point for WebGL in the app.
//
// Contract (04_3D_WebGL_Architecture.md + P12-04 Opt-in Performance Gate):
// - The scene is decorative, aria-hidden, pointer-transparent; every piece of
//   admin functionality is real DOM above it. Losing WebGL loses nothing.
// - On initial mount, Three.js / scene-canvas is NOT auto-downloaded; the calm
//   CSS architectural frame renders immediately with 0 KB WebGL JS.
// - Only when the operator clicks the opt-in toggle button (and reduced-motion
//   is off + WebGL probe passes) is ./scene-canvas dynamically imported.
// - Context loss or toggling off unmounts the WebGL canvas back to CSS cleanly.

"use client";

import { useCallback, useEffect, useState, type ComponentType } from "react";

type WebglProbe = WebGLRenderingContext | WebGL2RenderingContext | null;

function webglSupported(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebglProbe;
    if (!gl) return false;
    // Release the probe context immediately.
    const lose = gl.getExtension("WEBGL_lose_context");
    lose?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function reducedMotionEnabled(): boolean {
  try {
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

export function AdminScene({ active = false }: { active?: boolean }) {
  const [Scene, setScene] = useState<ComponentType<{ onContextLost: () => void }> | null>(null);

  const onContextLost = useCallback(() => {
    setScene(null);
  }, []);

  useEffect(() => {
    if (!active || Scene) return;
    let cancelled = false;
    if (reducedMotionEnabled() || !webglSupported()) return;
    void (async () => {
      try {
        const mod = await import("./scene-canvas");
        if (!cancelled) setScene(() => mod.default);
      } catch {
        if (!cancelled) setScene(null); // Chunk/network failure: CSS frame remains.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, Scene]);

  const showScene = active && Scene !== null;

  return (
    <div className="adm-scene-host" aria-hidden="true">
      <div className="adm-scene-fallback" data-scene-fallback={showScene ? "covered" : "visible"} />
      {showScene ? <Scene onContextLost={onContextLost} /> : null}
    </div>
  );
}

export function AdminViewportSceneControl({
  roles,
  motionChild,
}: {
  roles: string[];
  motionChild?: React.ReactNode;
}) {
  const [sceneActive, setSceneActive] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const onToggle = useCallback(() => {
    if (sceneActive) {
      setSceneActive(false);
      setStatusMessage(null);
      return;
    }
    if (reducedMotionEnabled()) {
      setStatusMessage("المشهد ثلاثي الأبعاد متوقف احترامًا لإعداد تقليل الحركة.");
      return;
    }
    if (!webglSupported()) {
      setStatusMessage("المتصفح الحالي لا يدعم تشغيل العرض ثلاثي الأبعاد.");
      return;
    }
    setStatusMessage(null);
    setSceneActive(true);
  }, [sceneActive]);

  return (
    <section className="adm-viewport" aria-label="هوية مركز التشغيل">
      {motionChild}
      <div className="adm-viewport-canvas">
        <AdminScene active={sceneActive} />
      </div>
      <div className="adm-viewport-scrim" aria-hidden="true" />
      <div className="adm-viewport-content">
        <div className="adm-viewport-head">
          <p className="adm-viewport-kicker">هايبر المعتصم · لوحة التشغيل</p>
          <button
            type="button"
            className="adm-scene-toggle-btn"
            aria-pressed={sceneActive}
            onClick={onToggle}
          >
            {sceneActive ? "إيقاف المشهد ثلاثي الأبعاد" : "تشغيل المشهد ثلاثي الأبعاد"}
          </button>
        </div>
        <h2 className="adm-viewport-title">من القراءة إلى المتابعة</h2>
        <p className="adm-viewport-text">
          اختر الفترة، راجع تعريف الأرقام، وانتقل مباشرةً إلى الطلبات أو المنتجات المطابقة. أي مصدر غير متاح يظهر بحالته الصريحة دون تقدير.
        </p>
        {statusMessage ? (
          <p className="adm-viewport-text" role="status">
            {statusMessage}
          </p>
        ) : null}
        <div className="adm-viewport-tags">
          {roles.length ? (
            roles.map((role) => (
              <span key={role} className="adm-viewport-tag">
                {role}
              </span>
            ))
          ) : (
            <span className="adm-viewport-tag">حساب من غير أدوار</span>
          )}
          <span className="adm-viewport-tag">توقيت القاهرة</span>
        </div>
      </div>
    </section>
  );
}
