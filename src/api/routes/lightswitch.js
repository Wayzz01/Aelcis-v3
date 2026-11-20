const express = require("express");
const router = express.Router();

const status = (serviceId = "Fortnite") => ({
  serviceInstanceId: "fortnite",
  status: "UP",
  message: "Alecis-v3 is online",
  maintenanceUri: null,
  overrideCatalogIds: ["a7f138b2e51945ffbfdacc1af0541053"],
  allowedActions: [],
  banned: false,
  launcherInfoDTO: {
    appName: serviceId,
    catalogItemId: "4fe75bbc5a674f4f9b356b5c90567da5",
    namespace: "fn",
  },
});

router.get("/lightswitch/api/service/bulk/status", (req, res) => {
  res.json([status("Fortnite")]);
});

router.get("/lightswitch/api/service/Fortnite/status", (req, res) => {
  res.json(status("Fortnite"));
});

router.get("/lightswitch/api/service/:serviceId/status", (req, res) => {
  res.json(status(req.params.serviceId));
});

module.exports = router;
