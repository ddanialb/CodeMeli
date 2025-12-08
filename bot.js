require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const { checkUserExists } = require("./checker");

const BOT_TOKEN = process.env.BOT_TOKEN;
const TARGET_URL = process.env.TARGET_URL;
const PORT = process.env.PORT || 3000;
const CONCURRENT_REQUESTS = parseInt(process.env.CONCURRENT_REQUESTS) || 20;
const DELAY_BETWEEN_BATCHES =
  parseInt(process.env.DELAY_BETWEEN_BATCHES) || 100;

const app = express();

app.get("/", (req, res) => {
  res.json({
    status: "Bot is running",
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

app.get("/health", (req, res) => res.send("OK"));

app.listen(PORT, () => {
  console.log(`Express server running on port ${PORT}`);
});

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const userStates = {};
const activeTests = {};

console.log("Telegram bot started!");

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    `
*National Code Checker Bot*

*Commands:*
/test - Start new test
/stop - Stop current test
/status - Check test status

*How to use:*
1. Send /test
2. Enter start number
3. Enter end number
4. Wait for results!
  `,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/test/, (msg) => {
  const chatId = msg.chat.id;

  if (activeTests[chatId]) {
    bot.sendMessage(chatId, "A test is already running! Use /stop first");
    return;
  }

  userStates[chatId] = { step: "waiting_start" };
  bot.sendMessage(chatId, "*Enter start number:*\n\n(Example: 18884121)", {
    parse_mode: "Markdown",
  });
});

bot.onText(/\/stop/, (msg) => {
  const chatId = msg.chat.id;

  if (activeTests[chatId]) {
    activeTests[chatId].stopped = true;
    const lastTested = activeTests[chatId].lastTested || "N/A";
    const tested = activeTests[chatId].tested;
    const found = activeTests[chatId].found;

    bot.sendMessage(
      chatId,
      `
*Test Stopped!*

Last tested: \`${lastTested}\`
Total tested: ${tested}
Found: ${found}
      `,
      { parse_mode: "Markdown" }
    );
  } else {
    bot.sendMessage(chatId, "No active test!");
  }
});

bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;

  if (activeTests[chatId]) {
    const test = activeTests[chatId];
    const progress = ((test.tested / test.total) * 100).toFixed(2);
    const elapsed = Math.floor((Date.now() - test.startTime) / 1000);
    const speed = elapsed > 0 ? (test.tested / elapsed).toFixed(1) : 0;

    bot.sendMessage(
      chatId,
      `
*Test Status:*

Tested: ${test.tested} / ${test.total}
Progress: ${progress}%
Found: ${test.found}
Last tested: \`${test.lastTested || "N/A"}\`
Time: ${elapsed}s
Speed: ${speed}/s
    `,
      { parse_mode: "Markdown" }
    );
  } else {
    bot.sendMessage(chatId, "No active test!");
  }
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text?.startsWith("/")) return;

  const state = userStates[chatId];
  if (!state) return;

  if (state.step === "waiting_start") {
    const start = text.replace(/\D/g, "");
    if (!start || start.length < 1) {
      bot.sendMessage(chatId, "Invalid number! Try again:");
      return;
    }

    state.start = start;
    state.step = "waiting_end";
    bot.sendMessage(chatId, "*Enter end number:*\n\n(Example: 18884200)", {
      parse_mode: "Markdown",
    });
    return;
  }

  if (state.step === "waiting_end") {
    const end = text.replace(/\D/g, "");
    if (!end || end.length < 1) {
      bot.sendMessage(chatId, "Invalid number! Try again:");
      return;
    }

    state.end = end;
    delete userStates[chatId];

    await startTesting(chatId, state.start, state.end);
  }
});

async function testBatch(codes) {
  return Promise.all(codes.map((code) => checkUserExists(code, TARGET_URL)));
}

async function startTesting(chatId, startNum, endNum) {
  const start = BigInt(startNum);
  const end = BigInt(endNum);
  const total = Number(end - start) + 1;

  activeTests[chatId] = {
    tested: 0,
    found: 0,
    total: total,
    stopped: false,
    startTime: Date.now(),
    lastTested: null,
  };

  await bot.sendMessage(
    chatId,
    `
*Starting Test!*

From: \`${startNum.padStart(10, "0")}\`
To: \`${endNum.padStart(10, "0")}\`
Total: ${total.toLocaleString()}
Concurrent: ${CONCURRENT_REQUESTS}
Delay: ${DELAY_BETWEEN_BATCHES}ms

Use /stop to stop
Use /status for status
  `,
    { parse_mode: "Markdown" }
  );

  const foundList = [];
  let tested = 0;
  let lastReportAt = 0;

  for (let i = start; i <= end; i += BigInt(CONCURRENT_REQUESTS)) {
    if (activeTests[chatId]?.stopped) {
      break;
    }

    const batch = [];
    for (let j = i; j < i + BigInt(CONCURRENT_REQUESTS) && j <= end; j++) {
      batch.push(j.toString().padStart(10, "0"));
    }

    try {
      const results = await testBatch(batch);

      for (const result of results) {
        tested++;
        activeTests[chatId].tested = tested;
        activeTests[chatId].lastTested = result.nationalNo;

        if (result.exists) {
          foundList.push(result.nationalNo);
          activeTests[chatId].found = foundList.length;

          await bot.sendMessage(
            chatId,
            `*FOUND!*\n\n\`${result.nationalNo}\``,
            { parse_mode: "Markdown" }
          );
        }
      }

      if (tested - lastReportAt >= 100) {
        lastReportAt = tested;
        const progress = ((tested / total) * 100).toFixed(1);
        const elapsed = Math.floor(
          (Date.now() - activeTests[chatId].startTime) / 1000
        );
        const speed = elapsed > 0 ? (tested / elapsed).toFixed(1) : 0;

        await bot.sendMessage(
          chatId,
          `*${tested.toLocaleString()}* tested (${progress}%)\nSpeed: ${speed}/s\nFound: ${
            foundList.length
          }`,
          { parse_mode: "Markdown" }
        );
      }
    } catch (err) {
      console.error("Batch error:", err.message);
    }

    await new Promise((r) => setTimeout(r, DELAY_BETWEEN_BATCHES));
  }

  const elapsed = Math.floor(
    (Date.now() - activeTests[chatId].startTime) / 1000
  );
  const speed = elapsed > 0 ? (tested / elapsed).toFixed(1) : 0;
  const lastTested = activeTests[chatId].lastTested;

  let finalMsg = `
*Test Complete!*

Tested: ${tested.toLocaleString()}
Last: \`${lastTested}\`
Time: ${elapsed}s
Speed: ${speed}/s
Found: ${foundList.length}
`;

  if (foundList.length > 0) {
    finalMsg += `\n*Found List:*\n`;
    foundList.forEach((code, i) => {
      finalMsg += `${i + 1}. \`${code}\`\n`;
    });
  }

  await bot.sendMessage(chatId, finalMsg, { parse_mode: "Markdown" });

  delete activeTests[chatId];
}

bot.on("polling_error", (error) => {
  console.error("Polling error:", error.message);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
});
