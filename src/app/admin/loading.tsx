// ADMIN LOADING STATE — what the operator sees while a page is being prepared.
//
// Every admin page is a server component: it waits for its data before the
// HTML is sent, and the browser shows this frame in the meantime. The frame
// carries no numbers — a skeleton that shows a fake "0" or a fake count would
// be a lie the operator reads as data. It only says that the page is on its
// way and that the numbers will be the real ones.
//
// The layout already owns the <main> landmark, so this file renders the
// frame alone.

export default function AdminLoading() {
  return (
    <div className="adm-loading" role="status" aria-live="polite">
      <span className="adm-loading-bar adm-loading-bar--title" />
      <span className="adm-loading-bar adm-loading-bar--intro" />
      <div className="adm-loading-panel">
        <span className="adm-loading-bar adm-loading-bar--panel" />
        <span className="adm-loading-line" />
        <span className="adm-loading-line" />
        <span className="adm-loading-line adm-loading-line--short" />
      </div>
      <p className="adm-loading-hint">الصفحة بتتحمّل — الأرقام هتظهر لأنها محسوبة من بيانات المتجر.</p>
    </div>
  );
}
