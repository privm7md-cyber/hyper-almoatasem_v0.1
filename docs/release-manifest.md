# Release Manifest — Hyper Al-Moatasem / هايبر المعتصم

```text
Project: Hyper Al-Moatasem (grocery hypermarket e-commerce, Arabic-first, EGP)
Release purpose: Auth foundation freeze (admin authentication on frozen DB architecture)
Date: 2026-09-24
Node: v24.21.0
Next: 16.3.5
Prisma: CLI 7.10.0 + @prisma/client 7.10.0 (+ @prisma/adapter-pg 7.10.0)
PostgreSQL target: 18.4
Database architecture version: FINAL (31 frozen tables + 6 designed, Final ERD V1)
Baseline migration: 20260923_baseline__official (resolved on production, steps=0)
Auth migration: 20260923_admin_auth_foundation (tested on scratch, NOT on production)
Seed version: bootstrap/system seed only (prisma/seed.mjs, credential-free)
Auth architecture version: custom DB-backed opaque sessions + Argon2id (docs/admin-auth-architecture.md)
```

## Release identity

```text
Release SHA (code freeze): f73ce0b984b3bbbebdfdce92d9aa6c4aab04708d
Manifest commit SHA (this file): recorded in the release report (second commit)
Previous production release: NONE
```

The release is the code-freeze commit. This manifest lives in a follow-up docs
commit that attests it (solving the self-reference: a manifest cannot contain
the SHA of a commit that contains the manifest). File hashes below are
identical in both commits (the second commit only adds this file).

## Staging → release identity

Staging runs had no Git SHA (repository had no commits): staging source
identity is RECONSTRUCTED — same working tree, proven by (a) no source file
modified after the green runs except comment/test-harness/docs, (b) a clean
`next build` + `tsc` + `eslint` + `prisma validate/generate` on this exact
tree, (c) the SHA-256 inventory below. From this release forward, identity is
VERIFIED by commit SHA.

## Critical file hashes (SHA-256, release tree)

```text
prisma/schema.prisma                                            BC51052D3BEBF8CB22598C20F65DBEA78C49F27A655E78658B239B22BF73FBBC
prisma.config.ts                                                5A78EC601506C2A357F7A47079ED27A1ACC3A3FA38C4B6BA84434742C246E7F0
package.json                                                    52EC7B6B4F95C2FB717826E53F7550BDF471E61367640E55F67423DB83B5246F
package-lock.json                                               285EB835932D5395361AEB692F59F7283ED42FC4C8BC8AF69D78A159077F064E
next.config.ts                                                  D9D178F5322EE3944770A2BF1C6602BE7717744C1BAED8CE1FEA71706CCB84BB
tsconfig.json                                                   9E76959E74ADC9EFA15635DD8ACB5C93CDEFB36C160A084B694F85E8834CCA22
eslint.config.mjs                                               870F1ADCCECF3051CBCD9FD307CEF51D7633CF510979C181A81F4B1797273493
src/proxy.ts                                                    86C9252EB839730EC50F0BD1104B3D15DAA04EF5B90D57DA8E08BEED8EB911D2
src/lib/db.ts                                                   910A3BADF219E3B9EFF38D093E111C0B6998FF7FB3E488971B79E02C22705C4E
src/lib/auth/audit.ts                                           A304F67D0CF4D16BF374EBA80E667BA0213BEA8FE4DB90690DCE0A1304163B0B
src/lib/auth/auth-tokens.ts                                     134E771DA8EC159D47A77B12C4FDB341C0FFA1D3F6BC6CB6DD1A21075CA4E35D
src/lib/auth/login.ts                                           8AD7360A0302FEDCD52BE6B71713B6835ED8EBDA08B56933112BFF97EF7840D1
src/lib/auth/password.ts                                        D1B64E14E41343AB0B19B61E9166C99E48DCD6891A7313CFCB02573F15CC3281
src/lib/auth/rate-limit.ts                                      55C05ECD8D4E69EA7172D03076FB55F3895CF1E6D5692A35205072AEB74FA383
src/lib/auth/rbac.ts                                            6E564A914AE6BFD45C444BEDCF552FB3F1DF2516D140463210BB2971285B3FEE
src/lib/auth/session.ts                                         2A115FF7F08AE195BAA2193AA41B00A98BC1FC4C6B15FF3163E89E18DB9BBA95
src/lib/auth/tokens.ts                                          673218EF72B2B8CB74B6073DE94C8FB11BB30D24D1DF93537BB35860B7514567
src/app/actions/auth.ts                                         6E1C365CDD3A2CC025E45AF1379238D3068027DD156073B43045C9DA0DE6B17F
src/app/admin/page.tsx                                          B07ADDBE5B854C585B0785003CB4146ABB001174E26F1F30398C1B44DC901D14
src/app/admin/login/page.tsx                                    34AF927F16B4B7BB5C969A8BB251E6D81BBD8ACA391B8AB9ACB0233F8500EB30
src/app/admin/login/LoginForm.tsx                               C6D47938D00F685537AAD499AEC1B2928D8E23DFA94353E3713D48607A65D5F5
src/app/admin/users/page.tsx                                    2F75BB12CB8037006B75C90B2053343E089C788F118AF24037A1A2FF0D4CFEED
src/app/api/admin/session/route.ts                              87948715C4AB521FFCB40024E5F0D10F6094E5EBF83F37FB0C6EF0ED8CD8A504
src/app/forbidden.tsx                                           0CFEE18E0C837063E0A4860EA51E3FD118BC33BF00E950179D43183BA1367897
src/app/layout.tsx                                              AC0A51F726D23D255BE241C5F37E47119736C2C3CDF5FEAC57F85DE677686EE5
src/app/page.tsx                                                5A51FDB3F4C514F83E3415B8568D481455656AFEC2167D61167181C6483C62FF
prisma/seed.mjs                                                 7B9118C0A59967F6E6E50A87E1723F4F3BF3503528F474BB697DF6379277CA94
scripts/bootstrap-admin-password.mjs                            44023A46F9A1854430DF0E537D1CFD9FADC71031D97921BC0AECB3B8242BC716
prisma/migrations/20260923_baseline__official/migration.sql     DE5D0ED8FFF148B7AA53AAEBB96C152E00B4B2C87CBDCBCFD816AE2D9EF605E8
prisma/migrations/20260923_baseline__official/supplement.sql    1C2C376213AB9956AE164A42A8B8C5A77BC27E73703951845468B6CE463776186D3FFDF7A1A0
prisma/migrations/20260923_baseline__official/README.md         0B0E61512480DB47503A9F4C1D08B66635875690B6CE463776186D3FFDF7A1A0
prisma/migrations/20260923_admin_auth_foundation/migration.sql  203C8E63C74D617CCD67DE86BE99A51F393AEB840582DDE3B06ED0134E2D4502
prisma/migrations/20260923_admin_auth_foundation/supplement.sql 35ECA56DDD6A1550AB9C908625A3AA76A4C3A4771EF5F95991619990A70FDBF3
prisma/migrations/20260923_admin_auth_foundation/README.md      7E8312425E00DE458A8718D5781A540805AEA081BF2ACDE8ED8454CE2BEAB723
```

No passwords, URLs, tokens, keys, cookies, or hashes of secrets appear here
— only SHA-256 of public source files.

## Production release policy

Production deploys ONLY from an immutable release SHA (never working tree,
zips, or `latest`). Rollback = previous release SHA; previous production
release: NONE (first release).
