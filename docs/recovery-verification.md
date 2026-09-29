# Recovery Verification — Hyper Al-Moatasem (no secrets in this file)

```text
Release SHA:            f73ce0b984b3bbbebdfdce92d9aa6c4aab04708d
Database identity:      hyper_almoatasem (PostgreSQL 18.4, Africa/Cairo)
PostgreSQL version:     server 18.4 / pg_dump 18.6 / pg_restore 18.6 / psql 18.6
Backup format:          pg_dump custom (-Fc), compressed
Backup timestamp:       2026-09-24T12:09:30+03:00
Backup path:            D:\Hyper_el-moatasem\_recovery\production-pre-auth-20260924.dump
Backup size:            133599 bytes
Backup SHA-256:         4BD9AACB0D28BB175EC6C6F73C25BC34591990CEA0D4B36AD01D99A5A8FF5062
```

## Source state at backup time (read-only verified)

31 business tables, 0 business rows; `_prisma_migrations` with the single
`20260923_baseline__official` row (steps=0, no rollback); no auth tables;
39 FKs, 155 CHECKs, 10 partial indexes, 22 triggers, 6 functions, view
`product_stock_status`, sequence `order_number_seq`, extension `pgcrypto`.
