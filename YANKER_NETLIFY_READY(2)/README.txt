YANKER — Netlify Ready
========================

این پوشه برای Deploy مستقیم روی Netlify آماده شده است.

فایل‌های اصلی:
- index.html
- admin.html
- netlify.toml
- package.json
- netlify/functions/api.mjs

دیتابیس:
از Netlify Blobs استفاده می‌شود و نیاز به Supabase ندارد.

راه‌اندازی:
1. فایل ZIP را Extract کن یا مستقیم ZIP را در Netlify Drop آپلود کن.
2. Netlify باید Build را بدون دستور خاص اجرا کند.
3. برای امنیت، در Site configuration > Environment variables این دو مقدار را تنظیم کن:
   ADMIN_USERNAME = نام کاربری مالک
   ADMIN_PASSWORD = یک رمز قوی

اگر این دو متغیر را تنظیم نکنی، مقدار پیش‌فرض توسعه‌ای فعال است:
username: owner
password: Yanker@Admin#2026

نکته:
برای استفاده واقعی حتماً ADMIN_PASSWORD را عوض کن.

API:
Frontend از /.netlify/functions/api استفاده می‌کند.
اطلاعات کاربران، درخواست‌ها، اعضا، اطلاعیه‌ها و تیکت‌ها در Netlify Blobs نگهداری می‌شوند.

تیکت:
کاربر می‌تواند داخل همان تیکت پیام بفرستد؛ پاسخ مدیریت هم به همان thread اضافه می‌شود.
