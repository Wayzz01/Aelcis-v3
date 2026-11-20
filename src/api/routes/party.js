const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

// In-memory party store (basic). Full party system is typically XMPP; these endpoints provide HTTP compatibility.
const parties = new Map();
const userParty = new Map();

function createParty(accountId, displayName) {
  const partyId = uuidv4().replace(/-/g, "");
  const party = {
    id: partyId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    config: {
      type: "DEFAULT",
      joinability: "OPEN",
      discoverability: "ALL",
      sub_type: "default",
      max_size: 16,
      invite_ttl: 14400,
      join_confirmation: false,
      intention_ttl: 60,
    },
    members: [{
      account_id: accountId,
      meta: { "urn:epic:member:dn_s": displayName || accountId },
      connections: [],
      revision: 0,
      updated_at: new Date().toISOString(),
      joined_at: new Date().toISOString(),
      role: "CAPTAIN",
    }],
    applicants: [],
    meta: {
      "urn:epic:cfg:party-notification-v0_b": "true",
      "urn:epic:cfg:accepting-members_b": "true",
      "urn:epic:cfg:invite-perm_s": "Anyone",
      "urn:epic:cfg:build-id_s": "1:1:",
      "urn:epic:cfg:join-request-action_s": "AutoAccept",
    },
    invites: [],
    revision: 0,
  };
  parties.set(partyId, party);
  userParty.set(accountId, partyId);
  return party;
}

router.get("/party/api/v1/Fortnite/user/:accountId", verifyToken, (req, res) => {
  const pid = userParty.get(req.params.accountId);
  const p = pid ? parties.get(pid) : null;
  res.json({ current: p ? [p] : [], pending: [], invites: [], pings: [] });
});

router.post("/party/api/v1/Fortnite/parties", verifyToken, (req, res) => {
  const party = createParty(req.accountId, req.user && req.user.username);
  res.json(party);
});

router.patch("/party/api/v1/Fortnite/parties/:partyId", verifyToken, (req, res) => {
  const p = parties.get(req.params.partyId);
  if (!p) return res.status(404).json({});
  Object.assign(p.meta, req.body.meta || {});
  p.updated_at = new Date().toISOString();
  p.revision++;
  res.status(204).end();
});

router.patch("/party/api/v1/Fortnite/parties/:partyId/members/:accountId/meta", verifyToken, (req, res) => {
  const p = parties.get(req.params.partyId);
  if (!p) return res.status(404).json({});
  const m = p.members.find(x => x.account_id === req.params.accountId);
  if (m) { Object.assign(m.meta, req.body || {}); m.updated_at = new Date().toISOString(); m.revision++; }
  res.status(204).end();
});

router.post("/party/api/v1/Fortnite/parties/:partyId/members/:accountId/join", verifyToken, (req, res) => {
  const p = parties.get(req.params.partyId);
  if (!p) return res.status(404).json({});
  if (!p.members.find(x => x.account_id === req.params.accountId)) {
    p.members.push({ account_id: req.params.accountId, meta: { "urn:epic:member:dn_s": req.user?.username || req.params.accountId }, connections: [], revision: 0, updated_at: new Date().toISOString(), joined_at: new Date().toISOString(), role: "MEMBER" });
    userParty.set(req.params.accountId, p.id);
  }
  res.status(204).end();
});

router.delete("/party/api/v1/Fortnite/parties/:partyId/members/:accountId", verifyToken, (req, res) => {
  const p = parties.get(req.params.partyId);
  if (p) {
    p.members = p.members.filter(m => m.account_id !== req.params.accountId);
    userParty.delete(req.params.accountId);
    if (!p.members.length) parties.delete(p.id);
  }
  res.status(204).end();
});

router.post("/party/api/v1/Fortnite/parties/:partyId/members/:accountId/promote", (req, res) => res.status(204).end());

router.get("/party/api/v1/Fortnite/parties/:partyId", (req, res) => {
  const p = parties.get(req.params.partyId);
  if (!p) return res.status(404).json({});
  res.json(p);
});

router.post("/party/api/v1/Fortnite/user/:accountId/pings/:pingerId", (req, res) => res.json({}));
router.delete("/party/api/v1/Fortnite/user/:accountId/pings/:pingerId", (req, res) => res.status(204).end());
router.post("/party/api/v1/Fortnite/parties/:partyId/invites/:accountId", (req, res) => res.status(204).end());

module.exports = router;
