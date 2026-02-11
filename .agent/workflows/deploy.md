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

## Dizin Yapısı (Sunucuda)

```
/opt/apps/custom/ssactivewear/everydaycustomprint/
├── docker-compose.yml          # Container tanımı
├── Dockerfile                  # Build dosyası
├── .env                        # Environment variables
└── prisma/                     # Veritabanı ve Schema
    ├── schema.prisma
    ├── dev.sqlite              # SQLite veritabanı dosyası
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
npm run deploy -- --force
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

## Veritabanı İşlemleri (SQLite)

Bu uygulama SQLite kullanır. Veritabanı dosyası container içinde `/app/prisma/dev.sqlite` yolundadır ve sunucuda volume olarak map edilmiştir.

### Prisma Migration
```bash
ssh appserver "sudo docker exec ssactivewear-everydaycustomprint npx prisma migrate deploy"
```

### Prisma DB Push (schema değişikliği)
```bash
ssh appserver "sudo docker exec ssactivewear-everydaycustomprint npx prisma db push"
```

### Veritabanı Yedeği Almak
```bash
ssh appserver "cp /opt/apps/custom/ssactivewear/everydaycustomprint/prisma/dev.sqlite /opt/apps/custom/ssactivewear/everydaycustomprint/prisma/dev.sqlite.bak_$(date +%Y%m%d)"
```

---

## Kritik .env Değişkenleri (Sunucu)

| Değişken | Değer | Açıklama |
|----------|-------|----------|
| `DATABASE_URL` | `file:./dev.sqlite` | SQLite bağlantısı |
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

1. **SQLite dikkat**: Veritabanı dosya bazlı, silinirse tüm veriler gider. Deploy öncesi yedek almak iyi pratiktir.
2. **Caddy ayarları** `/opt/apps/caddy/Caddyfile` içindedir — DOKUNMA.
3. **Redis** paylaşımlı, DB index 0 kullanılıyor.
4. **Extension deploy** sadece widget (liquid/JS) değişikliklerinde gereklidir, backend değişikliklerinde gerekmez.
5. **Eski sunucu bilgileri geçersiz** — `ssaw-e.techifyboost.com` / `5.78.132.44` / PM2 artık kullanılmıyor. Yeni sunucu `104.236.78.45` / `ssh appserver` / Docker.
