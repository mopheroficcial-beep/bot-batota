// تخزين بسيط بملف JSON — يكفي للتجربة والتطوير، استبدله بقاعدة بيانات حقيقية (Postgres/SQLite) عند الإنتاج
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FILE = process.env.DB_FILE || "./db.json";

function load() {
  if (!existsSync(FILE)) return { creators: {}, orders: [] };
  return JSON.parse(readFileSync(FILE, "utf-8"));
}

function persist(data) {
  writeFileSync(FILE, JSON.stringify(data, null, 2));
}

export const db = load();

export function saveDb() {
  persist(db);
}

// creator = { userId, channelId, groupId, botConnected, earnings, msgPrice, products: [], subs: [] }
export function getCreator(userId) {
  return db.creators[userId];
}

export function upsertCreator(userId, patch) {
  db.creators[userId] = { ...(db.creators[userId] || { userId, earnings: 0, products: [], subs: [] }), ...patch };
  saveDb();
  return db.creators[userId];
}

export function addOrder(order) {
  db.orders.push(order);
  saveDb();
  return order;
}
