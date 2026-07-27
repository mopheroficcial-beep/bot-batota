import "dotenv/config";
import { Bot, InlineKeyboard, GrammyError, HttpError } from "grammy";
import { getCreator, upsertCreator, addOrder } from "./db.js";
import { startServer } from "./server.js";

const bot = new Bot(process.env.BOT_TOKEN);
const MINIAPP_URL = process.env.MINIAPP_URL || "https://example.com/miniapp/index.html";

bot.command("start", async (ctx) => {
  const kb = new InlineKeyboard()
    .webApp("🦆 افتح لوحة المبدع", MINIAPP_URL)
    .row()
    .text("🔌 ربط قناتي وإنشاء قروبي الخاص", "connect_start");

  await ctx.reply(
    "أهلاً 👋\nأنا بوتك اللي هيدير منتجاتك الرقمية، اشتراكاتك، تبرعاتك، وطلباتك المخصصة — كل ده من قروب خاص بيك.",
    { reply_markup: kb }
  );
});

bot.callbackQuery("connect_start", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    [
      "🔧 خطوات الربط:",
      "1) ضيفني أدمن في قناتك/قروبك (صلاحية نشر + إدارة).",
      "2) ابعت هنا يوزر القناة بالشكل ده: @channel_username",
      "3) هعمل تلقائيًا قروب خاص بيك تستقبل فيه أي طلب تخصيص من عملائك.",
      "",
      "⚠️ ملاحظة تقنية: Telegram Bot API مايسمحش للبوت إنه ينشئ قروب من الصفر بنفسه — المطلوب إنك تعمل قروب فاضي وتضيف البوت فيه أدمن، وبعدها البوت يتولى كل حاجة تلقائي جوه القروب ده.",
    ].join("\n")
  );
  pendingChannel.set(ctx.from.id, true);
});

const pendingChannel = new Map();
const pendingGroup = new Map();

bot.on("message:text", async (ctx, next) => {
  const uid = ctx.from.id;

  if (pendingChannel.get(uid)) {
    const channel = ctx.message.text.trim();
    upsertCreator(uid, { channelId: channel });
    pendingChannel.delete(uid);
    pendingGroup.set(uid, true);
    await ctx.reply(
      `✅ تمام، اتسجلت القناة: ${channel}\n\nدلوقتي:\n1) اعمل قروب تليجرام جديد فاضي.\n2) ضيفني فيه وخليني أدمن.\n3) ابعت هنا يوزر/آيدي القروب ده.`
    );
    return;
  }

  if (pendingGroup.get(uid)) {
    const group = ctx.message.text.trim();
    upsertCreator(uid, { groupId: group, botConnected: true });
    pendingGroup.delete(uid);
    await ctx.reply(
      [
        `🎉 تم! القروب الخاص بيك اتفعّل: ${group}`,
        "من دلوقتي أي:",
        "• طلب منتج مخصص (Custom Product)",
        "• رسالة خاصة مدفوعة",
        "• سؤال دعم من عميل",
        "هتوصل إشعارات عنها فورًا هنا في القروب ده، وترد عليها من جواه.",
      ].join("\n")
    );
    return;
  }

  await next();
});

bot.command("order", async (ctx) => {
  const parts = ctx.match?.split(" ") ?? [];
  const creatorId = parts[0];
  const details = parts.slice(1).join(" ") || "بدون تفاصيل";
  const creator = getCreator(creatorId);

  if (!creator || !creator.groupId) {
    await ctx.reply("⚠️ المبدع لسه ما فعّلش القروب الخاص بيه.");
    return;
  }

  const order = addOrder({
    id: Date.now(),
    creatorId,
    customerId: ctx.from.id,
    customerName: ctx.from.first_name,
    details,
    status: "pending",
  });

  const kb = new InlineKeyboard()
    .text("✅ موافقة", `order_ok_${order.id}`)
    .text("✏️ تعديل السعر", `order_price_${order.id}`)
    .text("❌ رفض", `order_no_${order.id}`);

  await bot.api.sendMessage(
    creator.groupId,
    `🦆 طلب مخصص جديد من ${order.customerName}:\n"${details}"`,
    { reply_markup: kb }
  );

  await ctx.reply("✅ اتبعت طلبك للمبدع، هيوصلك رد قريب.");
});

bot.callbackQuery(/order_ok_(\d+)/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "تمت الموافقة ✅" });
  await ctx.editMessageText(ctx.callbackQuery.message.text + "\n\n✅ تمت الموافقة — جاري التسليم للعميل.");
});

bot.callbackQuery(/order_no_(\d+)/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "تم الرفض" });
  await ctx.editMessageText(ctx.callbackQuery.message.text + "\n\n❌ تم رفض الطلب.");
});

bot.callbackQuery(/order_price_(\d+)/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "ابعت السعر الجديد كرسالة" });
});

bot.command("pay", async (ctx) => {
  const [amountStr, ...titleParts] = (ctx.match || "").split(" ");
  const amount = parseInt(amountStr, 10) || 50;
  const title = titleParts.join(" ") || "دعم / اشتراك";

  await ctx.replyWithInvoice(
    title,
    "ادفع بسهولة عبر Telegram Stars ⭐️",
    JSON.stringify({ uid: ctx.from.id, ts: Date.now() }),
    "XTR",
    [{ label: title, amount }]
  );
});

bot.on("pre_checkout_query", async (ctx) => {
  await ctx.answerPreCheckoutQuery(true);
});

bot.on("message:successful_payment", async (ctx) => {
  await ctx.reply("🎉 تم الدفع بنجاح! شكراً لدعمك.");
});

bot.catch((err) => {
  const e = err.error;
  if (e instanceof GrammyError) console.error("Telegram API error:", e.description);
  else if (e instanceof HttpError) console.error("Network error:", e);
  else console.error("Unknown error:", e);
});

startServer(bot);
bot.start();
console.log("🦆 Kaffa bot is running...");
