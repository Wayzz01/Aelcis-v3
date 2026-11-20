const express = require("express");
const { verifyToken } = require("../../middleware/auth");
const mcp = require("../../../core/services/mcp");
const { getOrCreateProfile } = require("../../../core/services/profiles");

const router = express.Router();

// All profile operations
router.post("/fortnite/api/game/v2/profile/:accountId/client/:command", verifyToken, async (req, res) => {
  try {
    const { accountId, command } = req.params;
    if (req.accountId !== accountId) {
      // allow but usually should match; be permissive
    }
    const profileId = req.query.profileId || req.body.profileId || "athena";
    if (/purchase|battle|gift/i.test(command)) {
      try { console.log(`[MCP] ${command} account=${accountId} profile=${profileId} offerId=${(req.body||{}).offerId} qty=${(req.body||{}).purchaseQuantity} currency=${(req.body||{}).currency}`); } catch {}
    }
    const result = await mcp.applyCommand(accountId, profileId, command, req.body || {}, req.query || {});
    return res.json(result);
  } catch (err) {
    console.error("MCP error", err);
    return res.status(500).json({ errorCode: "errors.com.epicgames.common.server_error", errorMessage: err.message, numericErrorCode: 1000, originatingService: "fortnite", intent: "prod-live" });
  }
});

router.post("/fortnite/api/game/v2/profile/:accountId/dedicated_server/:command", async (req, res) => {
  try {
    const { accountId, command } = req.params;
    const profileId = req.query.profileId || req.body.profileId || "athena";
    const result = await mcp.applyCommand(accountId, profileId, command, req.body || {}, req.query || {});
    return res.json(result);
  } catch (err) {
    console.error("MCP DS error", err);
    return res.status(500).json({ errorCode: "errors.com.epicgames.common.server_error", errorMessage: err.message, numericErrorCode: 1000, originatingService: "fortnite", intent: "prod-live" });
  }
});

// Some builds call without /client/
router.post("/fortnite/api/game/v2/profile/:accountId/:command", verifyToken, async (req, res) => {
  try {
    const { accountId, command } = req.params;
    const profileId = req.query.profileId || req.body.profileId || "athena";
    const result = await mcp.applyCommand(accountId, profileId, command, req.body || {}, req.query || {});
    return res.json(result);
  } catch (err) {
    console.error("MCP alt error", err);
    return res.status(500).json({ errorCode: "errors.com.epicgames.common.server_error", errorMessage: err.message, numericErrorCode: 1000, originatingService: "fortnite", intent: "prod-live" });
  }
});

module.exports = router;
