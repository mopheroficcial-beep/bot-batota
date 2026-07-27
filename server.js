import "dotenv/config";
import express from "express";
import { verifyInitData } from "./verifyInitData.js";
import { getCreator, upsertCreator, addOrder } from "./db.js";

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3001;

export function startServer(bot) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type, X-Telegram-Init-Data");
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  function auth(req, res, next) {
    const initData = req.header("X-Telegram-Init-Data") || "";
    const result = verifyInitData(initData, BOT_TOKEN);
    if (!result || !result.user) {
      return res.status(401).json({ error: "بيانات دخول غير صالحة، افتح التطبيق من داخل تليجرام" });
    }
    req.uid = String(result.user.id);
    req.tgUser = result.user;
    next();
  }

  app.get("/api/state", auth, (req, res) => {
    const creator = getCreator(req.uid) || upsertCreator(req.uid, {});
    res.json(creator);
  });

  app.post("/api/connect", auth, (req, res) => {
    const { channelId, groupId } = req.body;
    if (!channelId || !groupId) return res.status(400).json({ error: "لازم تبعت القناة والقروب" });
    const creator = upsertCreator(req.uid, { channelId, groupId, botConnected: true });
    res.json(creator);
  });

  app.post("/api/products", auth, (req, res) => {
    const { type, title, price, description } = req.body;
    if (!type || !title) return res.status(400).json({ error: "لازم نوع وعنوان المنتج" });
    const creator = getCreator(req.uid) || upsertCreator(req.uid, {});
    const product = { id: Date.now(), type, title, price: price || 0, description: description || "" };
    const products = [...(creator.products || []), product];
    upsertCreator(req.uid, { products });
    res.json(product);
  });

  app.post("/api/msgprice", auth, (req, res) => {
    const { price } = req.body;
    upsertCreator(req.uid, { msgPrice: price });
    res.json({ ok: true, price });
  });

  app.post("/api/order", auth, async (req, res) => {
    const { creatorId, productId, details } = req.body;
    const creator = getCreator(creatorId);
    if (!creator || !creator.groupId) {
      return res.status(404).json({ error: "المبدع لسه ما فعّلش القروب الخاص بيه" });
    }

    const order = addOrder({
      id: Date.now(),
      creatorId,
      productId: productId || null,
      customerId: req.uid,
      customerName: req.tgUser.first_name || "عميل",
      details,
      status: "pending",
    });

    const { InlineKeyboard } = await import("grammy");
    const kb = new InlineKeyboard()
      .text("✅ موافقة", `order_ok_${order.id}`)
      .text("✏️ تعديل السعر", `order_price_${order.id}`)
      .text("❌ رفض", `order_no_${order.id}`);

    await bot.api.sendMessage(
      creator.groupId,
      `🦆 طلب مخصص جديد من ${order.customerName}:\n"${details}"`,
      { reply_markup: kb }
    );

    res.json({ ok: true, orderId: order.id });
  });

  app.post("/api/invoice", auth, async (req, res) => {
    const { title, description, amount, payload } = req.body;
    try {
      const link = await bot.api.createInvoiceLink(
        title || "دعم",
        description || "ادفع عبر Telegram Stars",
        payload || JSON.stringify({ uid: req.uid, ts: Date.now() }),
        "",
        "XTR",
        [{ label: title || "دعم", amount: amount || 50 }]
      );
      res.json({ link });
    } catch (e) {
      res.status(500).json({ error: e.description || "فشل إنشاء رابط الدفع" });
    }
  });

  app.listen(PORT, () => console.log(`🌐 API server running on :${PORT}`));
  return app;
}
