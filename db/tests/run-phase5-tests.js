// PHASE 5 tests — real PostgreSQL (PGlite) on SHIPPED files.
// TEST-ENV SHIMS ONLY (never shipped): pgcrypto line neutralised in-memory + stub
// gen_random_uuid(); all tests send explicit UUIDs. Shipped bytes untouched.
const { PGlite } = require('@electric-sql/pglite');
const fs = require('fs');
const path = require('path');
const DBDIR = path.join(__dirname, '..');
let seq = 900000;
const uid = () => '02800000-0000-7000-8000-' + String(seq++).padStart(12, '0');
let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log('PASS ' + n); };
const bad = (n, e) => { fail++; console.log('FAIL ' + n + ' :: ' + String(e && e.message || e).split('\n')[0]); };

(async () => {
  const db = new PGlite();
  const q = (s, p) => db.query(s, p);
  await db.exec(`CREATE OR REPLACE FUNCTION gen_random_uuid() RETURNS uuid LANGUAGE sql AS $$
    SELECT format('%s-%s-4%s-%s-%s', substr(m,1,8), substr(m,9,4), substr(m,13,3), substr(m,17,4), substr(m,21,12))::uuid
    FROM md5(random()::text || clock_timestamp()::text) AS m; $$;`);
  for (const f of ['phase1-schema.sql', 'phase1-seed-example.sql', 'phase2-schema.sql', 'phase2-seed-example.sql',
    'phase4-schema.sql', 'phase4-seed-example.sql', 'phase5-schema.sql', 'phase5-seed-example.sql']) {
    let sql = fs.readFileSync(path.join(DBDIR, f), 'utf8');
    if (f === 'phase1-schema.sql') sql = sql.replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', '-- [TEST SHIM] pgcrypto unavailable in PGlite');
    await db.exec(sql);
  }
  ok('SETUP all shipped files load (phases 1+2+4+5)');
  const eff = (userId) => q(`SELECT p.key FROM permissions p
    JOIN role_permissions rp ON rp.permission_id = p.id
    JOIN roles r ON r.id = rp.role_id AND r.is_active
    JOIN user_roles ur ON ur.role_id = r.id
    JOIN users u ON u.id = ur.user_id AND u.is_active
    WHERE u.id = $1 AND p.is_active`, [userId]).then(r => r.rows.map(x => x.key).sort());

  try {
    // ---- seed baseline ----
    const seed = async (t, w) => Number((await q(`SELECT COUNT(*) c FROM ${t} ${w || ''}`)).rows[0].c);
    (await seed('roles') === 2 && await seed('permissions') === 31) ? ok('SEED roles=2 permissions=31') : bad('SEED base');
    (await seed('role_permissions', `WHERE role_id='02800000-0000-7000-8000-000000000001'`) === 31
      && await seed('role_permissions', `WHERE role_id='02800000-0000-7000-8000-000000000002'`) === 24)
      ? ok('SEED matrix 31 / 24') : bad('SEED matrix');
    (await seed('store_settings') === 8) ? ok('SEED settings=8') : bad('SEED settings');

    // ---- users ----
    await q(`INSERT INTO users (id, name, email) VALUES ($1,'No At','no-at')`, [uid()])
      .then(() => bad('U1 bad email rejected', 'accepted')).catch((e) => /chk_users_email/.test(e.message) ? ok('U1 bad email rejected') : bad('U1', e));
    await q(`INSERT INTO users (id, name, email) VALUES ($1,'Upper','ADMIN@X.COM')`, [uid()])
      .then(() => bad('U2 uppercase email rejected', 'accepted')).catch((e) => /chk_users_email/.test(e.message) ? ok('U2 uppercase email rejected') : bad('U2', e));
    await q(`INSERT INTO users (id, name, email) VALUES ($1,'Dup','owner@hyper-al-moatasem.local')`, [uid()])
      .then(() => bad('U3 dup email rejected', 'accepted')).catch((e) => /duplicate|unique/i.test(e.message) ? ok('U3 dup email rejected') : bad('U3', e));
    const uA = (await q(`INSERT INTO users (id, name, email, phone) VALUES ($1,'A','a@x.com','201000000011') RETURNING id`, [uid()])).rows[0].id;
    await q(`INSERT INTO users (id, name, email, phone) VALUES ($1,'B','b@x.com','201000000011')`, [uid()])
      .then(() => bad('U4 dup phone rejected', 'accepted')).catch((e) => /duplicate|unique/i.test(e.message) ? ok('U4 dup phone rejected') : bad('U4', e));
    await q(`INSERT INTO users (id, name, email) VALUES ($1,'C','c@x.com')`, [uid()]);
    await q(`INSERT INTO users (id, name, email) VALUES ($1,'D','d@x.com')`, [uid()]);
    ok('U5 NULL phones coexist');
    await q(`UPDATE users SET deleted_at=now() WHERE id=$1`, [uA])
      .then(() => bad('U6 delete-while-active rejected', 'accepted')).catch((e) => /chk_users_deleted_consistency/.test(e.message) ? ok('U6 delete-while-active rejected') : bad('U6', e));
    await q(`UPDATE users SET is_active=FALSE, deleted_at=now() WHERE id=$1`, [uA]);
    ok('U7 soft delete ok');

    // ---- roles ----
    await q(`INSERT INTO roles (id, name) VALUES ($1,'STORE_ADMIN')`, [uid()])
      .then(() => bad('R1 dup role rejected', 'accepted')).catch((e) => /duplicate|unique/i.test(e.message) ? ok('R1 dup role rejected') : bad('R1', e));
    await q(`INSERT INTO roles (id, name) VALUES ($1,'INVENTORY MANAGER')`, [uid()])
      .then(() => bad('R2 spaced name rejected', 'accepted')).catch((e) => /chk_roles_name/.test(e.message) ? ok('R2 spaced name rejected') : bad('R2', e));
    await q(`INSERT INTO roles (id, name) VALUES ($1,'INVENTORY_MANAGER')`, [uid()]);
    ok('R3 future role needs zero DDL');

    // ---- user_roles ----
    const owner = '02800000-0000-7000-8000-000000000010', superR = '02800000-0000-7000-8000-000000000001';
    await q(`INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)`, [owner, superR])
      .then(() => bad('UR1 dup pair rejected', 'accepted')).catch((e) => /duplicate|unique/i.test(e.message) ? ok('UR1 dup pair rejected') : bad('UR1', e));
    await q(`INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)`, [uid(), superR])
      .then(() => bad('UR2 ghost user rejected', 'accepted')).catch((e) => /foreign key|violates/i.test(e.message) ? ok('UR2 ghost user rejected (FK)') : bad('UR2', e));
    await q(`DELETE FROM roles WHERE id=$1`, [superR])
      .then(() => bad('UR3 role delete blocked while mapped', 'accepted')).catch((e) => /violates|RESTRICT|foreign key/i.test(e.message) ? ok('UR3 role delete blocked (RESTRICT)') : bad('UR3', e));
    await q(`DELETE FROM users WHERE id=$1`, [owner])
      .then(() => bad('UR4 user delete blocked while mapped', 'accepted')).catch((e) => /violates|RESTRICT|foreign key/i.test(e.message) ? ok('UR4 user delete blocked (RESTRICT)') : bad('UR4', e));

    // ---- permissions ----
    for (const [n, k] of [['P1', 'Products.View'], ['P2', 'products view'], ['P3', 'products-view']])
      await q(`INSERT INTO permissions (id, key) VALUES ($1,$2)`, [uid(), k])
        .then(() => bad(n + ' bad key rejected', 'accepted')).catch((e) => /chk_permissions_key/.test(e.message) ? ok(n + ' bad key rejected') : bad(n, e));
    await q(`INSERT INTO permissions (id, key) VALUES ($1,'products.view')`, [uid()])
      .then(() => bad('P4 dup key rejected', 'accepted')).catch((e) => /duplicate|unique/i.test(e.message) ? ok('P4 dup key rejected') : bad('P4', e));
    await q(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,(SELECT id FROM permissions WHERE key='products.view'))`, [superR])
      .then(() => bad('RP1 dup grant rejected', 'accepted')).catch((e) => /duplicate|unique/i.test(e.message) ? ok('RP1 dup grant rejected') : bad('RP1', e));
    await q(`DELETE FROM permissions WHERE key='products.view'`)
      .then(() => bad('RP2 permission delete blocked while granted', 'accepted')).catch((e) => /violates|RESTRICT|foreign key/i.test(e.message) ? ok('RP2 permission delete blocked (RESTRICT)') : bad('RP2', e));

    // ---- matrix (effective grants) ----
    const allKeys = (await q(`SELECT key FROM permissions`)).rows.map(x => x.key);
    const seff = await eff(owner);
    (seff.length === 31 && allKeys.every(k => seff.includes(k))) ? ok('M1 SUPER_ADMIN effective = all 31') : bad('M1 super', seff.length);
    const storeU = (await q(`INSERT INTO users (id, name, email) VALUES ($1,'Store','store@x.com') RETURNING id`, [uid()])).rows[0].id;
    await q(`INSERT INTO user_roles (user_id, role_id) VALUES ($1,'02800000-0000-7000-8000-000000000002')`, [storeU]);
    const meff = await eff(storeU);
    const banned = ['users.view', 'users.manage', 'roles.view', 'roles.manage', 'settings.view', 'settings.manage', 'audit_logs.view'];
    (meff.length === 24 && banned.every(k => !meff.includes(k)) && meff.includes('products.update') && meff.includes('notifications.view'))
      ? ok('M2 STORE_ADMIN = 24, security keys excluded') : bad('M2 store', meff.length);
    await q(`UPDATE roles SET is_active=FALSE WHERE id='02800000-0000-7000-8000-000000000002'`);
    (await eff(storeU)).length === 0 ? ok('M3 disabled role authorizes nothing') : bad('M3 disabled role');
    await q(`UPDATE roles SET is_active=TRUE WHERE id='02800000-0000-7000-8000-000000000002'`);
    await q(`UPDATE users SET is_active=FALSE WHERE id=$1`, [storeU]);
    (await eff(storeU)).length === 0 ? ok('M4 disabled user authorizes nothing') : bad('M4 disabled user');
    await q(`UPDATE users SET is_active=TRUE WHERE id=$1`, [storeU]);

    // ---- audit ----
    await q(`INSERT INTO audit_logs (actor_type, action, entity_type) VALUES ('ADMIN','products.update','products')`)
      .then(() => bad('A1 ADMIN userless rejected', 'accepted')).catch((e) => /chk_audit_actor_pair/.test(e.message) ? ok('A1 ADMIN userless rejected') : bad('A1', e));
    await q(`INSERT INTO audit_logs (user_id, actor_type, action, entity_type) VALUES ($1,'SYSTEM','products.update','products')`, [owner])
      .then(() => bad('A2 SYSTEM with user rejected', 'accepted')).catch((e) => /chk_audit_actor_pair/.test(e.message) ? ok('A2 SYSTEM with user rejected') : bad('A2', e));
    await q(`INSERT INTO audit_logs (actor_type, action, entity_type) VALUES ('SYSTEM','job.run','system')`);
    ok('A3 SYSTEM anonymous ok');
    await q(`INSERT INTO audit_logs (actor_type, action, entity_type) VALUES ('SYSTEM','Bad Action','products')`)
      .then(() => bad('A4 bad action rejected', 'accepted')).catch((e) => /chk_audit_action/.test(e.message) ? ok('A4 bad action rejected') : bad('A4', e));
    const aid = (await q(`INSERT INTO audit_logs (user_id, actor_type, action, entity_type, entity_id, old_values, new_values, ip_address)
      VALUES ($1,'ADMIN','prices.update','product_variants','01800000-0000-7000-8000-000000000201',
      '{"price": "15.00"}','{"price": "17.00"}','127.0.0.1') RETURNING id`, [owner])).rows[0].id;
    const aq = (await q(`SELECT new_values->>'price' p FROM audit_logs WHERE id=$1`, [aid])).rows[0].p;
    (aq === '17.00') ? ok('A5 JSONB payload queryable') : bad('A5 JSONB', aq);
    const noUpd = await q(`SELECT COUNT(*) c FROM information_schema.columns WHERE table_name='audit_logs' AND column_name='updated_at'`);
    (noUpd.rows[0].c == 0) ? ok('A6 no updated_at on audit (immutable)') : bad('A6 updated_at exists');

    // ---- settings ----
    const setOK = [['BOOLEAN', 'true'], ['INTEGER', '-30'], ['NUMERIC', '20.00'], ['TEXT', 'anything {} ['], ['JSON', '{"a":[1,2]}']];
    for (const [t, v] of setOK) await q(`INSERT INTO store_settings (id, key, value_text, value_type) VALUES ($1,$2,$3,$4)`, [uid(), 't.' + t.toLowerCase() + Math.floor(Math.random()*1e9), v, t]);
    ok('S1 valid BOOLEAN/INTEGER/NUMERIC/TEXT/JSON accepted');
    for (const [n, t, v] of [['S2', 'BOOLEAN', 'yes'], ['S3', 'INTEGER', '12x'], ['S4', 'NUMERIC', '12.5x'], ['S5', 'JSON', '{broken']])
      await q(`INSERT INTO store_settings (id, key, value_text, value_type) VALUES ($1,$2,$3,$4)`, [uid(), 'bad.' + n.toLowerCase() + Math.floor(Math.random()*1e9), v, t])
        .then(() => bad(n + ' mistyped rejected', 'accepted')).catch(() => ok(n + ' mistyped rejected'));
    await q(`INSERT INTO store_settings (id, key, value_text, value_type) VALUES ($1,'currency','X','TEXT')`, [uid()])
      .then(() => bad('S6 dup key rejected', 'accepted')).catch((e) => /duplicate|unique/i.test(e.message) ? ok('S6 dup key rejected') : bad('S6', e));

    // ---- notifications ----
    const n1 = (await q(`INSERT INTO notifications (user_id, type, title, message, data) VALUES ($1,'order.created','New order','Order HM-1 placed','{"order_number":"HM-1"}') RETURNING id`, [owner])).rows[0].id;
    const nr = (await q(`SELECT read_at r, data->>'order_number' o FROM notifications WHERE id=$1`, [n1])).rows[0];
    (nr.r === null && nr.o === 'HM-1') ? ok('N1 unread default + JSONB data') : bad('N1', JSON.stringify(nr));
    const uB = (await q(`INSERT INTO users (id, name, email) VALUES ($1,'E','e@x.com') RETURNING id`, [uid()])).rows[0].id;
    const inboxB = await q(`SELECT COUNT(*) c FROM notifications WHERE user_id=$1`, [uB]);
    (inboxB.rows[0].c == 0) ? ok('N2 inbox isolated per user') : bad('N2 isolation');
    await q(`DELETE FROM users WHERE id=$1`, [uB]); // uB has nothing: no mappings, no audit, no notifications
    const goneB = await q(`SELECT COUNT(*) c FROM users WHERE id=$1`, [uB]);
    (goneB.rows[0].c == 0) ? ok('N3 unreferenced user deletable (no RESTRICT trip)') : bad('N3 delete');
    const uC = (await q(`INSERT INTO users (id, name, email) VALUES ($1,'F','f@x.com') RETURNING id`, [uid()])).rows[0].id;
    await q(`INSERT INTO notifications (user_id, type, title, message) VALUES ($1,'system','Hi','x')`, [uC]);
    await q(`DELETE FROM users WHERE id=$1`, [uC]);
    const left = await q(`SELECT COUNT(*) c FROM notifications WHERE user_id=$1`, [uC]);
    (left.rows[0].c == 0) ? ok('N4 inbox CASCADEs with user (non-evidentiary)') : bad('N4 cascade');

    // ---- cross-domain: no admin_* duplicates; frozen CHECKs alive ----
    const adm = await q(`SELECT COUNT(*) c FROM information_schema.tables WHERE table_name LIKE 'admin\\_%'`);
    (adm.rows[0].c == 0) ? ok('X1 no admin_* duplicate entities') : bad('X1 duplicates');
    await q(`INSERT INTO products (category_id, product_type, unit, name, slug) VALUES ('01800000-0000-7000-8000-000000000001','WEIGHT','PIECE','x','x-frozen-probe')`)
      .then(() => bad('X2 frozen weight rule alive', 'accepted')).catch((e) => /chk_products_weight_rule/.test(e.message) ? ok('X2 frozen weight rule alive') : bad('X2', e));
    await q(`INSERT INTO product_codes (product_variant_id, code, type) VALUES ('01800000-0000-7000-8000-000000000201','2010106','BARCODE')`)
      .then(() => bad('X3 frozen code UQ alive', 'accepted')).catch((e) => /duplicate|unique/i.test(e.message) ? ok('X3 frozen code UQ alive') : bad('X3', e));

    // ---- counts ----
    const tcount = await q(`SELECT COUNT(*) c FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'
      AND table_name IN ('users','roles','user_roles','permissions','role_permissions','audit_logs','store_settings','notifications')`);
    (tcount.rows[0].c == 8) ? ok('C-COUNT 8/8 Phase 5 tables') : bad('C-COUNT', tcount.rows[0].c);
    const fkcount = await q(`SELECT COUNT(*) c FROM pg_constraint WHERE contype='f' AND conrelid IN
      ('users'::regclass,'roles'::regclass,'user_roles'::regclass,'permissions'::regclass,'role_permissions'::regclass,
       'audit_logs'::regclass,'store_settings'::regclass,'notifications'::regclass)`);
    // user_roles 2 + role_permissions 2 + audit 1 + notifications 1 = 6
    (fkcount.rows[0].c == 6) ? ok('C-FK 6 new FKs (mappings ×4, audit, inbox)') : bad('C-FK', fkcount.rows[0].c);
    const uqcount = await q(`SELECT COUNT(*) c FROM pg_constraint WHERE contype='u' AND conrelid IN
      ('users'::regclass,'roles'::regclass,'user_roles'::regclass,'permissions'::regclass,'role_permissions'::regclass,
       'audit_logs'::regclass,'store_settings'::regclass,'notifications'::regclass)`);
    // users email + roles name + user_roles pair + permissions key + role_permissions pair
    // + settings key = 6 table CONSTRAINTs (the partial phone UQ is an index, not counted here)
    (uqcount.rows[0].c == 6) ? ok('C-UQ 6 new uniques (+1 partial index)') : bad('C-UQ', uqcount.rows[0].c);

    console.log(`\n==== RESULT: ${pass} passed, ${fail} failed ====`);
    process.exitCode = fail ? 1 : 0;
  } catch (e) { console.log('HARNESS ERROR: ' + e.message); process.exitCode = 1; }
})();
