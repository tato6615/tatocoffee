/* ════════════════════════════════════════
   TATO COFFEE — Cloudflare Pages Function
   วางไฟล์นี้ที่ /functions/_middleware.js ใน "โปรเจกต์ Pages เดียวกับ index.html"
   (repo/โฟลเดอร์เดียวกับที่ deploy tatocoffeev1.pages.dev อยู่ตอนนี้)

   ต่างจากแผนเดิม (Worker Route ข้ามโดเมน) ตรงที่ไฟล์นี้รันอยู่ "ในโดเมนเดียวกับเว็บ" อยู่แล้ว
   (Cloudflare Pages Functions) เลยไม่ต้องผูก Worker Route ข้าม zone ที่เสี่ยงชนกับ Pages เดิม
   — deploy พร้อมกับ index.html ปกติ ไม่ต้องตั้งค่าอะไรเพิ่มใน Dashboard เลย

   หลักการเดิม (dynamic rendering): ผู้ใช้จริง → ได้หน้าเดิมทุกประการ (ไม่แตะต้อง)
                                     บอทที่รู้จัก → ฉีดสินค้าจริงจาก Worker API ลงใน HTML ก่อนส่ง
════════════════════════════════════════ */

const API_BASE = 'https://origin-coffee-api.pakpiromjajaja.workers.dev';

const BOT_UA = /googlebot|bingbot|duckduckbot|baiduspider|yandexbot|applebot|facebookexternalhit|twitterbot|linkedinbot|slackbot|whatsapp|telegrambot|discordbot|gptbot|oai-searchbot|chatgpt-user|perplexitybot|claudebot|claude-web|anthropic-ai|google-extended|bytespider|ccbot|cohere-ai|meta-externalagent|meta-externalfetcher/i;

const SKELETON_GRID_HTML = '<div class="coffee-grid" id="coffeeGrid"><div class="skeleton-card"><div class="skeleton-shimmer"></div></div><div class="skeleton-card"><div class="skeleton-shimmer"></div></div><div class="skeleton-card"><div class="skeleton-shimmer"></div></div></div>';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function coffeeCardSSR(c) {
  const notes = (c.notes || []).map(n => `<span class="note">${escapeHtml(n)}</span>`).join('');
  const availability = c.soldOut ? 'OutOfStock' : 'InStock';
  const heroMedia = c.image
    ? `<img class="coffee-hero-img" src="${escapeHtml(c.image)}" alt="${escapeHtml(c.name)}" loading="lazy"><meta itemprop="image" content="${escapeHtml(c.image)}">`
    : `<span class="coffee-emoji">${escapeHtml(c.emoji)}</span>`;
  return `<div class="coffee-card" itemscope itemtype="https://schema.org/Product">
      <meta itemprop="name" content="${escapeHtml(c.name)}">
      <meta itemprop="description" content="${escapeHtml(c.desc || '')}">
      <div class="coffee-hero" style="background:${c.color}">${heroMedia}<div class="coffee-sca"><div class="sca-score">${c.score}</div><div class="sca-pts">SCA PTS</div></div></div>
      <div class="coffee-body">
        <div class="coffee-region">📍 ${escapeHtml(c.origin)}</div>
        <div class="coffee-name">${escapeHtml(c.name)}</div>
        <div class="coffee-process">⚗️ ${escapeHtml(c.process || '')}</div>
        <div class="notes-row">${notes}</div>
      </div>
      <div class="coffee-footer">
        <div class="coffee-price" itemprop="offers" itemscope itemtype="https://schema.org/Offer">
          ฿${c.price}<small>/ 250g</small>
          <meta itemprop="price" content="${c.price}"><meta itemprop="priceCurrency" content="THB">
          <meta itemprop="availability" content="https://schema.org/${availability}">
        </div>
      </div>
    </div>`;
}

// ── อัปโหลดรูปสินค้าจาก admin.html: proxy ไปยัง ImgBB API ──
// ป้องกันไม่ให้ IMGBB_KEY หลุดไปอยู่ฝั่ง browser โดยให้เซิร์ฟเวอร์นี้เป็นคนยิง request แทน
async function handleImageUpload(request, env) {
  const jsonHeaders = { 'Content-Type': 'application/json' };
  try {
    const apiKey = env.IMGBB_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ success: false, error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า IMGBB_KEY (ดูวิธีตั้งค่าใน Cloudflare Pages > Settings > Environment variables)' }), { status: 500, headers: jsonHeaders });
    }

    const incomingForm = await request.formData();
    const file = incomingForm.get('image');
    if (!file || typeof file === 'string') {
      return new Response(JSON.stringify({ success: false, error: 'ไม่พบไฟล์รูปภาพที่ส่งมา' }), { status: 400, headers: jsonHeaders });
    }
    if (file.size > 10 * 1024 * 1024) {
      return new Response(JSON.stringify({ success: false, error: 'ไฟล์ใหญ่เกิน 10MB' }), { status: 400, headers: jsonHeaders });
    }

    const outgoingForm = new FormData();
    outgoingForm.append('image', file, file.name || 'upload.jpg');

    const imgbbRes = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
      method: 'POST',
      body: outgoingForm,
    });
    const data = await imgbbRes.json();

    if (!imgbbRes.ok || !data.success) {
      const msg = (data && data.error && data.error.message) || 'อัปโหลดไปยัง ImgBB ไม่สำเร็จ';
      return new Response(JSON.stringify({ success: false, error: `ImgBB ปฏิเสธคำขอ: ${msg} (เช็คว่า IMGBB_KEY ถูกต้องและไม่มีอักขระเกินมาไหม)` }), { status: 502, headers: jsonHeaders });
    }

    return new Response(JSON.stringify({ success: true, url: data.data.url }), { status: 200, headers: jsonHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์: ' + e.message }), { status: 500, headers: jsonHeaders });
  }
}

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);

  // หน้าทดสอบ: เข้าลิงก์นี้ตรงๆ ในเบราว์เซอร์เพื่อเช็คว่าฟังก์ชันทำงานไหม (ไม่ต้องอัปโหลดรูปจริง)
  if (request.method === 'GET' && url.pathname === '/api/ping') {
    return new Response(JSON.stringify({
      ok: true,
      message: 'ฟังก์ชัน _middleware.js ทำงานอยู่! 🎉',
      hasImgbbKey: !!env.IMGBB_KEY,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // เส้นทางอัปโหลดรูป — ดักจับก่อนส่งต่อไป static asset เพราะ path นี้ไม่มีไฟล์จริงอยู่
  if (request.method === 'POST' && url.pathname === '/api/upload-image') {
    return handleImageUpload(request, env);
  }

  // ให้ Pages serve ทุกอย่างตามปกติก่อน (static asset, admin.html, ฯลฯ) — เราจะแก้เฉพาะ response
  const response = await next();

  // ทำงานเฉพาะ GET ที่ตอบกลับเป็น HTML เท่านั้น (หน้าเว็บหลัก) — asset อื่นผ่านไปตามปกติ
  const ct = response.headers.get('Content-Type') || '';
  if (request.method !== 'GET' || !ct.includes('text/html')) return response;

  const ua = request.headers.get('User-Agent') || '';
  if (!BOT_UA.test(ua)) return response; // ผู้ใช้จริง — คืนค่าหน้าเดิมทุกประการ ไม่แตะต้อง

  try {
    let html = await response.text();

    // fetch สินค้าจริงจาก Worker API ฝั่ง server (ไม่ผ่าน browser เลยไม่ติด CORS ใดๆ)
    const apiRes = await fetch(`${API_BASE}/api/coffees`, { cf: { cacheTtl: 60, cacheEverything: true } });
    if (!apiRes.ok) return new Response(html, response); // ดึงไม่ได้ก็คืนหน้าเดิมไป ดีกว่า error

    const coffees = (await apiRes.json()).filter(c => c.region !== 'subscription');

    if (html.includes(SKELETON_GRID_HTML)) {
      const cardsHTML = coffees.map(coffeeCardSSR).join('');
      html = html.replace(SKELETON_GRID_HTML, `<div class="coffee-grid" id="coffeeGrid">${cardsHTML}</div>`);
    }

    // JSON-LD ItemList — ช่วย Google Rich Result และ AI answer engine (ChatGPT/Perplexity/
    // Google AI Overview) ดึงราคา/สต็อกไปตอบผู้ใช้ได้แม่นยำ โดยไม่ต้องรัน JS เลย
    const itemList = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: coffees.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'Product',
          name: c.name,
          description: c.desc || '',
          ...(c.image ? { image: c.image } : {}),
          offers: {
            '@type': 'Offer',
            price: c.price,
            priceCurrency: 'THB',
            availability: `https://schema.org/${c.soldOut ? 'OutOfStock' : 'InStock'}`,
          },
        },
      })),
    };
    if (html.includes('</head>')) {
      html = html.replace('</head>', `<script type="application/ld+json">${JSON.stringify(itemList)}</script>\n</head>`);
    }

    return new Response(html, {
      status: response.status,
      headers: { ...Object.fromEntries(response.headers), 'Content-Type': 'text/html; charset=UTF-8', 'X-Dynamic-Rendered': 'bot' },
    });
  } catch (e) {
    // มีอะไรพลาด ก็คืนหน้าเดิมไปดีกว่าทำให้บอทเจอ error
    return response;
  }
}
