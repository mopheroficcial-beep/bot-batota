import "dotenv/config";
import express from "express";
import { verifyInitData } from "./verifyInitData.js";
import { getCreator, upsertCreator, addOrder, findOrder, updateOrder, findProduct } from "./db.js";

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3001;
const TON_WALLET_ADDRESS = process.env.TON_WALLET_ADDRESS || "";
const CRYPTOBOT_TOKEN = process.env.CRYPTOBOT_TOKEN || "";

export function startServer(bot) {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type, X-Telegram-Init-Data");
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  function auth(req, res, next) {
    const initData = req.header("X-Telegram-Init-Data") || req.query.initData || (req.body && req.body.initData) || "";
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
    const { type, title, price, description, imageUrl } = req.body;
    if (!type || !title) return res.status(400).json({ error: "لازم نوع وعنوان المنتج" });
    const creator = getCreator(req.uid) || upsertCreator(req.uid, {});
    const product = { id: Date.now(), type, title, price: price || 0, description: description || "", imageUrl: imageUrl || "" };
    const products = [...(creator.products || []), product];
    upsertCreator(req.uid, { products });
    res.json(product);
  });

  app.post("/api/subs", auth, (req, res) => {
    const { title, price, period } = req.body;
    if (!title || !price) return res.status(400).json({ error: "لازم اسم وسعر للخطة" });
    const creator = getCreator(req.uid) || upsertCreator(req.uid, {});
    const plan = { id: Date.now(), title, price: Number(price) || 0, period: period || "monthly", subscribers: 0 };
    const subs = [...(creator.subs || []), plan];
    upsertCreator(req.uid, { subs });
    res.json(plan);
  });

  app.post("/api/sub-confirm", auth, async (req, res) => {
    const { creatorId, planId } = req.body;
    const creator = getCreator(creatorId);
    if (!creator) return res.status(404).json({ error: "المبدع مش موجود" });
    const plan = (creator.subs || []).find((s) => String(s.id) === String(planId));
    if (!plan) return res.status(404).json({ error: "الخطة مش موجودة" });
    plan.subscribers = (plan.subscribers || 0) + 1;
    upsertCreator(creatorId, { subs: creator.subs, earnings: (creator.earnings || 0) + plan.price });
    if (creator.groupId) {
      try {
        await bot.api.sendMessage(
          creator.groupId,
          `⭐️ اشتراك جديد في خطة "${plan.title}" ($${plan.price}/${plan.period === "yearly" ? "سنة" : "شهر"}) من ${req.tgUser.first_name || "عميل"}`
        );
      } catch (e) {
        console.error("sendMessage to group failed:", e.description || e.message);
        return res.status(200).json({ ok: true, plan, warning: "الاشتراك اتسجل بس ما وصلش إشعار للقروب: " + (e.description || e.message) });
      }
    }
    res.json({ ok: true, plan });
  });

  app.get("/api/gallery", auth, (req, res) => {
    const creator = getCreator(req.uid) || upsertCreator(req.uid, {});
    const items = (creator.products || []).filter((p) => p.imageUrl);
    res.json({ items });
  });

  app.post("/api/buy", auth, async (req, res) => {
    const { creatorId, productId } = req.body;
    const creator = getCreator(creatorId);
    const product = findProduct(creatorId, productId);
    if (!creator || !creator.groupId) return res.status(404).json({ error: "المبدع لسه ما فعّلش القروب الخاص بيه" });
    if (!product) return res.status(404).json({ error: "المنتج مش موجود" });

    const order = addOrder({
      id: Date.now(),
      creatorId,
      productId,
      customerId: req.uid,
      customerName: req.tgUser.first_name || "عميل",
      details: `طلب شراء: ${product.title} ($${product.price})`,
      status: "pending",
    });

    const { InlineKeyboard } = await import("grammy");
    const kb = new InlineKeyboard()
      .text("📤 تسليم الصورة للعميل", `deliver_${order.id}`)
      .text("❌ رفض", `order_no_${order.id}`);

    try {
      await bot.api.sendMessage(
        creator.groupId,
        `🖼️ طلب شراء جديد من ${order.customerName}:\n"${product.title}" — $${product.price}`,
        { reply_markup: kb }
      );
    } catch (e) {
      console.error("sendMessage to group failed:", e.description || e.message);
      return res.status(200).json({ ok: true, orderId: order.id, warning: "الطلب اتسجل بس ما وصلش إشعار للقروب: " + (e.description || e.message) });
    }

    res.json({ ok: true, orderId: order.id });
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

    try {
      await bot.api.sendMessage(
        creator.groupId,
        `🦆 طلب مخصص جديد من ${order.customerName}:\n"${details}"`,
        { reply_markup: kb }
      );
    } catch (e) {
      console.error("sendMessage to group failed:", e.description || e.message);
      return res.status(200).json({ ok: true, orderId: order.id, warning: "الطلب اتسجل بس ما وصلش إشعار للقروب: " + (e.description || e.message) });
    }

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

  app.post("/api/pay/ton", auth, (req, res) => {
    if (!TON_WALLET_ADDRESS) return res.status(500).json({ error: "المحفظة مش مظبوطة على السيرفر (TON_WALLET_ADDRESS)" });
    const { amountTon, memo } = req.body;
    const nano = Math.round((Number(amountTon) || 0) * 1e9);
    const link = `ton://transfer/${TON_WALLET_ADDRESS}?amount=${nano}&text=${encodeURIComponent(memo || "Kaffa payment")}`;
    res.json({ link });
  });

  app.post("/api/pay/cryptobot", auth, async (req, res) => {
    if (!CRYPTOBOT_TOKEN) return res.status(500).json({ error: "بوابة الكريبتو مش مفعّلة على السيرفر (CRYPTOBOT_TOKEN)" });
    const { amount, asset, description } = req.body;
    try {
      const r = await fetch("https://pay.crypt.bot/api/createInvoice", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Crypto-Pay-API-Token": CRYPTOBOT_TOKEN },
        body: JSON.stringify({
          asset: asset || "USDT",
          amount: String(amount || 1),
          description: description || "Kaffa payment",
        }),
      });
      const data = await r.json();
      if (!data.ok) return res.status(500).json({ error: "فشل إنشاء فاتورة الكريبتو" });
      res.json({ payUrl: data.result.pay_url, invoiceId: data.result.invoice_id });
    } catch (e) {
      res.status(500).json({ error: "تعذر الاتصال ببوابة الكريبتو" });
    }
  });

  app.listen(PORT, () => console.log(`🌐 API server running on :${PORT}`));
  return app;
}
