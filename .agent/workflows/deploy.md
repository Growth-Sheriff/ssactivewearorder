---
description: Deploy changes to production server via Git + Docker
---

# SSActiveWear - EverydayCustomPrint Deploy & Sunucu Workflow

> ⚠️ **KURAL: Bu workflow SADECE SSActiveWear (EverydayCustomPrint) ile ilgilidir. Caddy, Redis, Uptime Kuma, CustomizerApp ve diğer servislere DOKUNMA. Sadece kendi container'ını yönet.**

---

## Sunucu Bilgileri

| Bilgi | Değer |
|-------|-------|
| **Sunucu IP** | `104.236.78.45` |
| **SSH Bağlantı** | `ssh appserver` |
| **SSH Config Alias** | `appserver` (key: `~/.ssh/appserver`) |
| **OS** | Ubuntu 24.04 LTS |
| **Docker Network** | `appnet` (bridge) |
| **Uygulama Domain** | `https://ssaw-e.techifyboost.com` |
| **CDN / R2 Public** | `https://img-ssa-e.techifyboost.com` |
| **GitHub Repo** | `git@github.com:Growth-Sheriff/ssactivewearorder.git` |
| **Branch** | `main` |
| **Local Dizin** | `c:\Users\mhmmd\Desktop\ssactiveorder` |

---

## Veritabanı Bilgileri (PostgreSQL - DigitalOcean Managed)

| Bilgi | Değer |
|-------|-------|
| **Provider** | PostgreSQL (DigitalOcean Managed Database) |
| **Host** | `private-db-postgresql-nyc3-64923-do-user-33221790-0.f.db.ondigitalocean.com` |
| **Port** | `25060` |
| **Database** | `ssactivewear_db` |
| **User** | `doadmin` |
| **SSL** | `sslmode=no-verify` |
| **Prisma Provider** | `postgresql` |
| **Prisma URL** | `env("DATABASE_URL")` |

> ⚠️ **ESKİ SQLite kullanılmıyor!** `file:dev.sqlite` referansı, `better-sqlite3` paketi ve SQLite volume mount artık geçersiz.

---

## Dizin Yapısı (Sunucuda)

```
/opt/apps/custom/ssactivewear/everydaycustomprint/
├── docker-compose.yml          # Container tanımı
├── Dockerfile                  # Build dosyası
├── .env                        # Environment variables (DATABASE_URL burada)
└── prisma/
    ├── schema.prisma           # PostgreSQL provider
    └── migrations/
```

---

## Docker Container'lar

### Senin Container'ın

| Container | Image | Port | Açıklama |
|-----------|-------|------|----------|
| `ssactivewear-everydaycustomprint` | Custom build | 3000 | Ana uygulama container'ı |

### ❌ DOKUNMA — Diğer Container'lar

| Container | Açıklama |
|-----------|----------|
| `caddy` | Reverse proxy |
| `redis` | Shared cache |
| `customizerapp-fastdtftransfer` | Başka uygulama |
| `customizerapp-fastdtf-db` | Başka uygulama veritabanı |

---

## Deploy Adımları

**Strict Rule**: NEVER use `scp` or direct file transfer to the server. ALL code changes must go through Git.

### Adım 1: Commit & Push (Local)
// turbo
```powershell
git add . && git commit -m "Değişiklik mesajı" && git push origin main
```

### Adım 2: Sunucuya Git Pull + Docker Rebuild
```powershell
ssh appserver "cd /opt/apps/custom/ssactivewear/everydaycustomprint && git pull && sudo docker compose up -d --build"
```

### Adım 3: Shopify Extension Deploy (widget/extension değişikliklerinde)
```powershell
npx shopify app deploy --force
```
Extension deploy'da "Release" sorusu gelirse `y` ile onayla.

---

## Sık Kullanılan Komutlar

### Container Durumu
```bash
ssh appserver "sudo docker ps --filter name=ssactivewear-everydaycustomprint"
```

### Uygulama Logları
```bash
ssh appserver "sudo docker logs ssactivewear-everydaycustomprint --tail 50"
```

### Canlı Log Takibi
```bash
ssh appserver "sudo docker logs ssactivewear-everydaycustomprint -f --tail 20"
```

### Health Check
```bash
ssh appserver "sudo docker exec caddy curl -s http://ssactivewear-everydaycustomprint:3000/health"
```

### Container Restart (rebuild olmadan)
```bash
ssh appserver "sudo docker restart ssactivewear-everydaycustomprint"
```

---

## Veritabanı İşlemleri (PostgreSQL)

Veritabanı artık DigitalOcean Managed PostgreSQL üzerinde çalışıyor. Container içinden erişiliyor (private network üzerinden).

### Prisma DB Push (schema değişikliği)
```bash
ssh appserver "sudo docker exec ssactivewear-everydaycustomprint npx prisma db push"
```

### Prisma Migration Deploy
```bash
ssh appserver "sudo docker exec ssactivewear-everydaycustomprint npx prisma migrate deploy"
```

### Prisma Studio (debug için - geçici)
```bash
ssh appserver "sudo docker exec ssactivewear-everydaycustomprint npx prisma studio"
```

### Veritabanı Yedeği (pg_dump - container içinden)
```bash
ssh appserver "sudo docker exec ssactivewear-everydaycustomprint sh -c 'npx prisma db execute --stdin <<< \"SELECT count(*) FROM \\\"Session\\\"\"'"
```

### Doğrudan PostgreSQL Bağlantısı (container içinden)
```bash
ssh appserver "sudo docker exec ssactivewear-everydaycustomprint npx prisma db execute --stdin"
```

---

## Kritik .env Değişkenleri (Sunucu)

| Değişken | Değer | Açıklama |
|----------|-------|----------|
| `DATABASE_URL` | `postgresql://doadmin:...@private-db-...:25060/ssactivewear_db?sslmode=no-verify&schema=public` | PostgreSQL bağlantısı |
| `REDIS_URL` | `redis://redis:6379/0` | Shared Redis, DB index 0 |
| `SHOPIFY_APP_URL` | `https://ssaw-e.techifyboost.com` | Uygulama domaini |
| `SHOPIFY_API_KEY` | `d5568d43c70e94118794afd517b5d8ef` | Shopify Client ID |
| `PORT` | `3000` | İç port |

---

## Shopify Uygulama Bilgileri

| Bilgi | Değer |
|-------|-------|
| **App Name** | SSActiveWear Sync |
| **Client ID** | `d5568d43c70e94118794afd517b5d8ef` |
| **App Proxy** | `/apps/ssactiveorder/*` → `https://ssaw-e.techifyboost.com/` |
| **Webhooks API** | `2026-04` |
| **Scopes** | `write_products,read_products,write_orders,read_orders,read_locations,read_inventory,write_inventory,read_shipping` |

---

## ⚠️ Önemli Notlar

1. **PostgreSQL kullanılıyor** — `file:dev.sqlite` artık geçersiz. Prisma schema'da `provider = "postgresql"` ve `url = env("DATABASE_URL")` olmalı.
2. **Veritabanı DigitalOcean Managed** — Private network üzerinden erişiliyor, SSL ile (`sslmode=no-verify`).
3. **Docker volume mount yok** — Eski SQLite volume (`./prisma/dev.sqlite:/app/prisma/dev.sqlite`) kaldırıldı.
4. **Caddy ayarları** `/opt/apps/caddy/Caddyfile` içindedir — DOKUNMA.
5. **Redis** paylaşımlı, DB index 0 kullanılıyor.
6. **Extension deploy** sadece widget (liquid/JS) değişikliklerinde gereklidir, backend değişikliklerinde gerekmez.
7. **33 tablo** PostgreSQL'de oluşturuldu, tüm mevcut veri aktarıldı.
8. **updatedAt** alanları PostgreSQL trigger fonksiyonu ile yönetiliyor (Prisma'nın `@updatedAt` yerine).
