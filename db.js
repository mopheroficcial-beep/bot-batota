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

export function findOrder(orderId) {
  return db.orders.find((o) => String(o.id) === String(orderId));
}

export function updateOrder(orderId, patch) {
  const order = findOrder(orderId);
  if (!order) return null;
  Object.assign(order, patch);
  saveDb();
  return order;
}

export function findProduct(creatorId, productId) {
  const creator = getCreator(creatorId);
  if (!creator) return null;
  return (creator.products || []).find((p) => String(p.id) === String(productId));
}
