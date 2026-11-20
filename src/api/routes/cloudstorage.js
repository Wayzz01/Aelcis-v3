const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();
const cloudDir = path.join(__dirname, "..", "..", "resources", "cloudstorage");

function ensureCloudDir() {
  if (!fs.existsSync(cloudDir)) fs.mkdirSync(cloudDir, { recursive: true });
}

function fileInfo(filePath, filename) {
  const stat = fs.statSync(filePath);
  const data = fs.readFileSync(filePath);
  const sha1 = crypto.createHash("sha1").update(data).digest("hex");
  const sha256 = crypto.createHash("sha256").update(data).digest("hex");
  return {
    uniqueFilename: filename,
    filename: filename,
    hash: sha1,
    hash256: sha256,
    length: stat.size,
    contentType: "application/octet-stream",
    uploaded: stat.mtime.toISOString(),
    storageType: "S3",
    storageIds: {},
    doNotCache: false,
  };
}

// System cloudstorage list
router.get("/fortnite/api/cloudstorage/system", (req, res) => {
  try {
    ensureCloudDir();
    const files = fs.readdirSync(cloudDir).filter(f => !f.startsWith("."));
    const list = files.map(f => {
      try { return fileInfo(path.join(cloudDir, f), f); } catch { return null; }
    }).filter(Boolean);
    res.json(list);
  } catch (e) {
    res.json([]);
  }
});

router.get("/fortnite/api/cloudstorage/system/:file", (req, res) => {
  try {
    const file = req.params.file;
    const filePath = path.join(cloudDir, path.basename(file));
    if (!fs.existsSync(filePath)) return res.status(404).end();
    const data = fs.readFileSync(filePath);
    res.setHeader("Content-Type", "application/octet-stream");
    res.send(data);
  } catch (e) {
    res.status(404).end();
  }
});

// User cloudstorage (settings, clientsettings.sav etc.) - allow read/write stubs
const userCloud = new Map(); // key: accountId:file -> Buffer

router.get("/fortnite/api/cloudstorage/user/:accountId", verifyToken, (req, res) => {
  const accountId = req.params.accountId;
  const list = [];
  for (const [key, val] of userCloud.entries()) {
    if (!key.startsWith(accountId + ":")) continue;
    const filename = key.split(":").slice(1).join(":");
    const sha1 = crypto.createHash("sha1").update(val).digest("hex");
    const sha256 = crypto.createHash("sha256").update(val).digest("hex");
    list.push({
      uniqueFilename: filename,
      filename,
      hash: sha1,
      hash256: sha256,
      length: val.length,
      contentType: "application/octet-stream",
      uploaded: new Date().toISOString(),
      storageType: "S3",
      storageIds: {},
      accountId,
      doNotCache: false,
    });
  }
  res.json(list);
});

router.get("/fortnite/api/cloudstorage/user/:accountId/:file", verifyToken, (req, res) => {
  const key = `${req.params.accountId}:${req.params.file}`;
  const data = userCloud.get(key);
  if (!data) return res.status(404).end();
  res.setHeader("Content-Type", "application/octet-stream");
  res.send(data);
});

router.put("/fortnite/api/cloudstorage/user/:accountId/:file", verifyToken, (req, res) => {
  const chunks = [];
  req.on("data", c => chunks.push(c));
  req.on("end", () => {
    const buf = Buffer.concat(chunks);
    const key = `${req.params.accountId}:${req.params.file}`;
    userCloud.set(key, buf);
    res.status(204).end();
  });
});

module.exports = router;
