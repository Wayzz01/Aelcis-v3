const express = require("express");
const Friend = require("../../core/models/Friend");
const User = require("../../core/models/User");
const { verifyToken } = require("../middleware/auth");
const { sendEpicError } = require("../../shared/utils/errors");

const router = express.Router();

async function getUserByAccountId(id) {
  return User.findOne({ accountId: id }).lean();
}

// Friends list (various endpoints used by different builds)
router.get("/friends/api/public/friends/:accountId", verifyToken, async (req, res) => {
  const { accountId } = req.params;
  if (req.accountId !== accountId) return res.json([]);
  const friends = await Friend.find({ accountId }).lean();
  const result = [];
  for (const f of friends) {
    if (f.status === "ACCEPTED") {
      result.push({ accountId: f.friendId, status: "ACCEPTED", direction: "OUTBOUND", created: f.created, favorite: !!f.favorite, alias: f.alias || "" });
    } else if (f.status === "PENDING_OUTGOING") {
      result.push({ accountId: f.friendId, status: "PENDING", direction: "OUTBOUND", created: f.created, favorite: false, alias: "" });
    } else if (f.status === "PENDING_INCOMING") {
      result.push({ accountId: f.friendId, status: "PENDING", direction: "INBOUND", created: f.created, favorite: false, alias: "" });
    }
  }
  res.json(result);
});

router.get("/friends/api/v1/:accountId/friends", verifyToken, async (req, res) => {
  const { accountId } = req.params;
  const friends = await Friend.find({ accountId, status: "ACCEPTED" }).lean();
  res.json(friends.map(f => ({ accountId: f.friendId, groups: [], alias: f.alias || "", note: f.note || "", favorite: !!f.favorite, created: f.created })));
});

router.get("/friends/api/v1/:accountId/summary", verifyToken, async (req, res) => {
  const { accountId } = req.params;
  const friends = await Friend.find({ accountId }).lean();
  const users = await User.find({}).select("accountId username").lean();
  const nameMap = new Map(users.map(u => [u.accountId, u.username]));
  const accepted = [], outgoing = [], incoming = [], blocklist = [];
  for (const f of friends) {
    const base = { accountId: f.friendId, displayName: nameMap.get(f.friendId) || f.friendId, alias: f.alias || "", note: f.note || "", favorite: !!f.favorite, created: f.created };
    if (f.status === "ACCEPTED") accepted.push(base);
    else if (f.status === "PENDING_OUTGOING") outgoing.push(base);
    else if (f.status === "PENDING_INCOMING") incoming.push(base);
    else if (f.status === "BLOCKED") blocklist.push(base);
  }
  res.json({
    friends: accepted,
    outgoing,
    incoming,
    suggested: [],
    blocklist,
    settings: { acceptInvites: "public", mutualPrivacy: "ALL" },
    limitsReached: { incoming: false, outgoing: false, accepted: false },
  });
});

// Blocklist
router.get("/friends/api/public/blocklist/:accountId", verifyToken, async (req, res) => {
  const blocked = await Friend.find({ accountId: req.params.accountId, status: "BLOCKED" }).lean();
  res.json({ blockedUsers: blocked.map(b => b.friendId) });
});
router.get("/friends/api/v1/:accountId/blocklist", verifyToken, async (req, res) => {
  const blocked = await Friend.find({ accountId: req.params.accountId, status: "BLOCKED" }).lean();
  res.json(blocked.map(b => ({ accountId: b.accountId, blockedAccountId: b.friendId })));
});

// Recent players stub
router.get("/friends/api/public/list/fortnite/:accountId/recentPlayers", (req, res) => res.json([]));
router.get("/friends/api/v1/:accountId/recent/fortnite", (req, res) => res.json([]));

// Settings
router.get("/friends/api/v1/:accountId/settings", (req, res) => res.json({ acceptInvites: "public", mutualPrivacy: "ALL" }));
router.patch("/friends/api/v1/:accountId/settings", (req, res) => res.json({ acceptInvites: req.body.acceptInvites || "public", mutualPrivacy: req.body.mutualPrivacy || "ALL" }));

// Add / send friend request
router.post("/friends/api/*/:accountId/:friendId", verifyToken, async (req, res, next) => {
  // match /friends/api/v1/:accountId/friends/:friendId or /friends/api/public/friends/:accountId/:friendId
  // handled below in more specific routes if needed
  next();
});

async function sendRequest(accountId, friendId) {
  if (accountId === friendId) return { error: "self" };
  const target = await getUserByAccountId(friendId);
  if (!target) return { error: "not_found" };
  const existing = await Friend.findOne({ accountId, friendId });
  const reverse = await Friend.findOne({ accountId: friendId, friendId: accountId });
  if (existing && existing.status === "BLOCKED") return { error: "blocked" };
  if (reverse && reverse.status === "BLOCKED") return { error: "blocked_by_target" };
  if (existing && existing.status === "ACCEPTED") return { ok: true };
  // if they already sent us a request, accept both
  if (reverse && reverse.status === "PENDING_OUTGOING") {
    reverse.status = "ACCEPTED"; await reverse.save();
    await Friend.updateOne({ accountId, friendId }, { $set: { status: "ACCEPTED", created: new Date() } }, { upsert: true });
    return { ok: true, accepted: true };
  }
  await Friend.updateOne({ accountId, friendId }, { $set: { status: "PENDING_OUTGOING", created: new Date() } }, { upsert: true });
  await Friend.updateOne({ accountId: friendId, friendId: accountId }, { $set: { status: "PENDING_INCOMING", created: new Date() } }, { upsert: true });
  return { ok: true };
}

router.post("/friends/api/v1/:accountId/friends/:friendId", verifyToken, async (req, res) => {
  const { accountId, friendId } = req.params;
  if (req.accountId !== accountId) return res.status(403).end();
  const r = await sendRequest(accountId, friendId);
  if (r.error === "not_found") return sendEpicError(res, 404, "errors.com.epicgames.friends.friend_request.account_not_found", "Account not found", 14004);
  res.status(204).end();
});

router.post("/friends/api/public/friends/:accountId/:friendId", verifyToken, async (req, res) => {
  const { accountId, friendId } = req.params;
  const r = await sendRequest(accountId, friendId);
  if (r.error === "not_found") return sendEpicError(res, 404, "errors.com.epicgames.friends.friend_request.account_not_found", "Account not found", 14004);
  res.status(204).end();
});

// Accept (often same as POST/add in some APIs, but also explicit accept paths exist in newer APIs; handle both)
// DELETE friend/request
router.delete("/friends/api/v1/:accountId/friends/:friendId", verifyToken, async (req, res) => {
  const { accountId, friendId } = req.params;
  await Friend.deleteOne({ accountId, friendId });
  await Friend.deleteOne({ accountId: friendId, friendId: accountId });
  res.status(204).end();
});

router.delete("/friends/api/public/friends/:accountId/:friendId", verifyToken, async (req, res) => {
  const { accountId, friendId } = req.params;
  await Friend.deleteOne({ accountId, friendId });
  await Friend.deleteOne({ accountId: friendId, friendId: accountId });
  res.status(204).end();
});

// Alias/nickname
router.put("/friends/api/v1/:accountId/friends/:friendId/alias", verifyToken, async (req, res) => {
  const { accountId, friendId } = req.params;
  const alias = req.body || req.query.alias || "";
  const val = typeof alias === "string" ? alias : (alias.alias || "");
  await Friend.updateOne({ accountId, friendId }, { $set: { alias: val } });
  res.status(204).end();
});
router.delete("/friends/api/v1/:accountId/friends/:friendId/alias", verifyToken, async (req, res) => {
  const { accountId, friendId } = req.params;
  await Friend.updateOne({ accountId, friendId }, { $set: { alias: "" } });
  res.status(204).end();
});

// Block / unblock
router.post("/friends/api/public/blocklist/:accountId/:friendId", verifyToken, async (req, res) => {
  const { accountId, friendId } = req.params;
  await Friend.updateOne({ accountId, friendId }, { $set: { status: "BLOCKED", created: new Date() } }, { upsert: true });
  await Friend.deleteOne({ accountId: friendId, friendId: accountId });
  res.status(204).end();
});
router.post("/friends/api/v1/:accountId/blocklist/:friendId", verifyToken, async (req, res) => {
  const { accountId, friendId } = req.params;
  await Friend.updateOne({ accountId, friendId }, { $set: { status: "BLOCKED", created: new Date() } }, { upsert: true });
  await Friend.deleteOne({ accountId: friendId, friendId: accountId });
  res.status(204).end();
});
router.delete("/friends/api/public/blocklist/:accountId/:friendId", verifyToken, async (req, res) => {
  const { accountId, friendId } = req.params;
  await Friend.deleteOne({ accountId, friendId, status: "BLOCKED" });
  res.status(204).end();
});
router.delete("/friends/api/v1/:accountId/blocklist/:friendId", verifyToken, async (req, res) => {
  const { accountId, friendId } = req.params;
  await Friend.deleteOne({ accountId, friendId, status: "BLOCKED" });
  res.status(204).end();
});

module.exports = router;
