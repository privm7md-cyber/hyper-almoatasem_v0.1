// second-agent-bage2e-probe.mjs — reproduces bag-e2e early steps.
const BASE = "http://127.0.0.1:3223";
const post = async (p, b, ck) => {
  const r = await fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(b) });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body, cookie: r.headers.get("set-cookie") };
};
const login = async (email, pw) => {
  const r = await post("/api/admin/auth/login", { email, password: pw });
  console.log("login", email, r.status);
  const sc = r.cookie || "";
  const m = sc.match(/([^;]+=[^;]+)/);
  return { status: r.status, cookie: m ? m[1] : null };
};
const store = await login("store-cat-test@example.com", "PLACEHOLDER");
console.log("store cookie?", !!store.cookie);
