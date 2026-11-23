const TOPIC = "AI dan perkembangan teknologi terbaru di Indonesia";
const MODEL_DEFAULT = "gemini-3.5-flash-lite";
const MAX_MESSAGES = 8;
const MAX_MESSAGE_CHARS = 2000;
const MAX_DAILY_PER_IP = 10;
const MAX_DAILY_GLOBAL = 200;
const MAX_PER_MINUTE = 12;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
function jakartaDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
async function gemini(contents, env, maxOutputTokens = 900, extra = "") {
  if (!env.GEMINI_API_KEY) throw new Error("API Gemini belum dipasang di Cloudflare Secret.");
  const model = env.GEMINI_MODEL || MODEL_DEFAULT;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: ["Kamu adalah zephr.ai, asisten AI yang ramah, cerdas, dan akurat. Gunakan bahasa Indonesia kecuali diminta lain. Jangan mengarang fakta atau sumber. Jelaskan jika informasi tidak cukup.", extra].filter(Boolean).join("\n\n") }] },
      contents,
      generationConfig: { maxOutputTokens, temperature: 0.55 }
    })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || `Gemini API error ${r.status}`);
  const answer = (data.candidates?.[0]?.content?.parts || []).filter(p => typeof p.text === "string").map(p => p.text).join("\n").trim();
  if (!answer) throw new Error("Gemini tidak menghasilkan teks.");
  return answer;
}
function decodeXml(s) {
  return String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
}
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return m ? decodeXml(m[1].replace(/<[^>]+>/g, "")) : "";
}
async function runDailyResearch(env) {
  const date = jakartaDate();
  const existing = await env.DB.prepare("SELECT report_json FROM research_reports WHERE report_date = ?").bind(date).first();
  if (existing?.report_json) return JSON.parse(existing.report_json);
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", TOPIC); url.searchParams.set("hl", "id"); url.searchParams.set("gl", "ID"); url.searchParams.set("ceid", "ID:id");
  const feedRes = await fetch(url, { headers: { "user-agent": "zephr.ai/1.0 daily-research" } });
  if (!feedRes.ok) throw new Error(`Google News RSS error ${feedRes.status}`);
  const xml = await feedRes.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 12).map(m => {
    const b = m[1];
    const sourceTag = b.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    return { title: tag(b, "title").slice(0, 300), link: tag(b, "link"), source: sourceTag ? decodeXml(sourceTag[1]) : "Google News RSS", publishedAt: tag(b, "pubDate") };
  }).filter(x => x.title && /^https?:\/\//i.test(x.link));
  if (!items.length) throw new Error("Feed berita tidak mengembalikan artikel.");
  const sourceText = items.map((x, i) => `${i+1}. ${x.title}\nSumber: ${x.source}\nTanggal: ${x.publishedAt}\nURL: ${x.link}`).join("\n\n");
  const prompt = `Buat laporan riset harian untuk topik: ${TOPIC}.\nTanggal laporan: ${date} (Asia/Jakarta).\nGunakan HANYA daftar berita berikut. Jangan menambahkan fakta yang tidak didukung judul/sumber. Bila detail tidak cukup, nyatakan perlu dibaca lebih lanjut.\n\nFormat: Ringkasan hari ini (2-3 kalimat), 3-5 perkembangan penting, Mengapa penting, Hal yang perlu dipantau. Bedakan fakta dan indikasi. Jangan menulis URL di badan laporan; sumber ditampilkan terpisah.\n\nDAFTAR ARTIKEL:\n${sourceText}`;
  const summary = await gemini([{ role: "user", parts: [{ text: prompt }] }], env, 1400);
  const report = { date, generatedAt: new Date().toISOString(), topic: TOPIC, summary, sources: items };
  await env.DB.prepare("INSERT OR REPLACE INTO research_reports (report_date, generated_at, topic, report_json) VALUES (?, ?, ?, ?)").bind(date, report.generatedAt, TOPIC, JSON.stringify(report)).run();
  return report;
}
async function checkLimits(request, env) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const ipHash = await sha256(ip);
  const date = jakartaDate();
  const minute = Math.floor(Date.now() / 60000);
  const minuteKey = `${date}-${minute}`;
  const minuteRow = await env.DB.prepare(`INSERT INTO minute_usage (minute_key, ip_hash, count) VALUES (?, ?, 1) ON CONFLICT(minute_key, ip_hash) DO UPDATE SET count = count + 1 RETURNING count`).bind(minuteKey, ipHash).first();
  if ((minuteRow?.count || 0) > MAX_PER_MINUTE) return "Terlalu banyak permintaan. Coba lagi dalam satu menit.";
  const ipRow = await env.DB.prepare(`INSERT INTO ip_daily_usage (usage_date, ip_hash, count) VALUES (?, ?, 1) ON CONFLICT(usage_date, ip_hash) DO UPDATE SET count = count + 1 RETURNING count`).bind(date, ipHash).first();
  if ((ipRow?.count || 0) > MAX_DAILY_PER_IP) return "Batas harian per pengunjung tercapai (10 pesan). Coba lagi besok.";
  const globalRow = await env.DB.prepare(`INSERT INTO global_daily_usage (usage_date, count) VALUES (?, 1) ON CONFLICT(usage_date) DO UPDATE SET count = count + 1 RETURNING count`).bind(date).first();
  if ((globalRow?.count || 0) > MAX_DAILY_GLOBAL) return "Batas penggunaan harian Zephr.ai tercapai. Silakan coba lagi besok.";
  return null;
}

async function uploadToGemini(request, env) {
  if (!env.GEMINI_API_KEY) {
    return json({ error: "API Gemini belum dikonfigurasi." }, 500);
  }

  const size = Number(request.headers.get("content-length") || 0);
  const mimeType = request.headers.get("content-type") || "";
  const MAX_FILE_SIZE = 50 * 1024 * 1024;

  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "application/pdf",
    "video/mp4",
    "video/mpeg",
    "video/quicktime",
    "video/webm",
    "audio/mpeg",
    "audio/wav",
    "audio/ogg",
    "audio/mp4",
    "audio/aac",
    "audio/flac"
  ];

  if (!size || size > MAX_FILE_SIZE) {
    return json({ error: "Ukuran file maksimal 50 MB." }, 413);
  }

  if (!allowedTypes.includes(mimeType)) {
    return json({ error: "Format file belum didukung." }, 415);
  }

  const name = new URL(request.url).searchParams.get("name") || "lampiran";

  try {
    const start = await fetch(
      "https://generativelanguage.googleapis.com/upload/v1beta/files",
      {
        method: "POST",
        headers: {
          "x-goog-api-key": env.GEMINI_API_KEY,
          "X-Goog-Upload-Protocol": "resumable",
          "X-Goog-Upload-Command": "start",
          "X-Goog-Upload-Header-Content-Length": String(size),
          "X-Goog-Upload-Header-Content-Type": mimeType,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          file: { display_name: name.slice(0, 200) }
        })
      }
    );

    if (!start.ok) {
      throw new Error("Gagal membuat sesi upload Gemini.");
    }

    const uploadUrl = start.headers.get("x-goog-upload-url");

    if (!uploadUrl) {
      throw new Error("URL upload Gemini tidak ditemukan.");
    }

    const uploaded = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Length": String(size),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
        "Content-Type": mimeType
      },
      body: request.body
    });

    const result = await uploaded.json().catch(() => ({}));

    if (!uploaded.ok || !result.file?.uri) {
      throw new Error(result.error?.message || "Upload Gemini gagal.");
    }

    return json({
      fileUri: result.file.uri,
      mimeType: result.file.mimeType || mimeType,
      name: result.file.displayName || name
    });

  } catch (error) {
    console.error("Gemini upload error:", error);
    return json({
      error: "Gagal mengunggah file ke Gemini. Silakan coba lagi."
    }, 502);
  }
}
async function handleApi(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/upload" && request.method === "POST") {
  return uploadToGemini(request, env);
  }
  if (url.pathname === "/api/health" && request.method === "GET") return json({ configured: Boolean(env.GEMINI_API_KEY), model: env.GEMINI_MODEL || MODEL_DEFAULT, provider: "Google Gemini", accessRequired: false, researchTopic: TOPIC, researchSchedule: "07:00 Asia/Jakarta" });
  if (url.pathname === "/api/research/latest" && request.method === "GET") {
    const row = await env.DB.prepare("SELECT report_json FROM research_reports ORDER BY report_date DESC LIMIT 1").first();
    return json({ report: row?.report_json ? JSON.parse(row.report_json) : null, topic: TOPIC, schedule: "07:00 Asia/Jakarta" });
  }
  if (url.pathname === "/api/chat" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "Format permintaan tidak valid." }, 400); }
    if (!Array.isArray(body?.messages) || !body.messages.length) return json({ error: "Pesan tidak valid." }, 400);
    
    const contents = [];

    try {
      const files = Array.isArray(body.files) ? body.files : [];

      if (files.length > 5) {
        throw new Error("Maksimal 5 lampiran.");
      }

      const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "application/pdf",
        "video/mp4",
        "video/mpeg",
        "video/quicktime",
        "video/webm",
        "audio/mpeg",
        "audio/wav",
        "audio/ogg",
        "audio/mp4",
        "audio/aac",
        "audio/flac"
      ];

      const validFiles = [];

      for (const file of files) {
        const mimeType = file?.mimeType;
        const fileUri = file?.fileUri;
        const name = String(file?.name || "lampiran");

        if (!allowedTypes.includes(mimeType)) {
          throw new Error("Format lampiran belum didukung.");
        }

        if (
          typeof fileUri !== "string" ||
          !fileUri.startsWith("https://generativelanguage.googleapis.com/")
        ) {
          throw new Error("Alamat lampiran tidak valid.");
        }

        validFiles.push({ name, mimeType, fileUri });
      }

      const recentMessages = body.messages.slice(-MAX_MESSAGES);

      for (let i = 0; i < recentMessages.length; i++) {
        const item = recentMessages[i];
        const role =
          item?.role === "assistant" ? "model" :
          item?.role === "user" ? "user" : null;

        const content =
          typeof item?.content === "string" ? item.content.trim() : "";

        if (!role || !content || content.length > MAX_MESSAGE_CHARS) {
          throw new Error("Format pesan tidak valid atau terlalu panjang.");
        }

        const parts = [{ text: content }];

        if (role === "user" && i === recentMessages.length - 1) {
          for (const file of validFiles) {
            parts.push({
              file_data: {
                mime_type: file.mimeType,
                file_uri: file.fileUri
              }
            });
          }
        }

        contents.push({ role, parts });
      }
    } catch (e) {
      return json({ error: e.message }, 400);
    }

    const blocked = await checkLimits(request, env);
    if (blocked) return json({ error: blocked }, 429);
    try {
      const row = await env.DB.prepare("SELECT report_json FROM research_reports ORDER BY report_date DESC LIMIT 1").first();
      const report = row?.report_json ? JSON.parse(row.report_json) : null;
      const context = report ? `LAPORAN RISET HARIAN TERBARU (${report.date}):\n${report.summary}\nSumber: ${(report.sources || []).slice(0,8).map(s => `${s.title} (${s.link})`).join("; ")}` : "Belum ada laporan riset harian yang tersimpan.";
      const reply = await gemini(contents, env, 700, context);
      return json({ reply, model: env.GEMINI_MODEL || MODEL_DEFAULT, provider: "Google Gemini" });
    } catch (e) {
      console.error("Gemini chat error", e);
      return json({ error: /429|quota|rate/i.test(e.message) ? "Kuota atau batas permintaan Gemini sedang tercapai. Coba lagi nanti." : "Gagal menghubungi Gemini. Periksa konfigurasi API Key dan model." }, 502);
    }
  }
  return json({ error: "Endpoint tidak ditemukan." }, 404);
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try { return await handleApi(request, env); }
      catch (e) { console.error("API error", e); return json({ error: "Terjadi kesalahan server. Coba lagi nanti." }, 500); }
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Zephr.ai assets belum dipasang.", { status: 503 });
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runDailyResearch(env).catch(e => console.error("Daily research failed", e)));
  }
};
