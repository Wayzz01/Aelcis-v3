const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

function getStore() {
  if (!global.__alecisMem) {
    global.__alecisMem = {
      users: [],
      profiles: [],
      friends: [],
      bans: [],
      saccodes: [],
      tournaments: [],
      purchases: [],
      quests: [],
    };
  }
  return global.__alecisMem;
}

function isConnected() {
  return mongoose.connection && mongoose.connection.readyState === 1;
}

function deepClone(v) {
  if (v instanceof Date) return new Date(v.getTime());
  if (v instanceof RegExp) return new RegExp(v.source, v.flags);
  if (Array.isArray(v)) return v.map(deepClone);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v)) out[k] = deepClone(v[k]);
    return out;
  }
  return v;
}

function getByPath(obj, path) {
  if (!path) return undefined;
  const parts = String(path).split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function setByPath(obj, path, value) {
  const parts = String(path).split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function toComparableDate(val) {
  if (val instanceof Date) return val.getTime();
  if (typeof val === "string" || typeof val === "number") {
    const t = new Date(val).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return val;
}

function matchCondition(docVal, cond) {
  if (cond instanceof RegExp) {
    if (docVal == null) return false;
    return cond.test(String(docVal));
  }
  if (cond && typeof cond === "object" && !Array.isArray(cond) && !(cond instanceof Date)) {
    // operator object
    for (const [op, val] of Object.entries(cond)) {
      if (op === "$in") {
        if (!Array.isArray(val) || !val.some(v => valueEquals(docVal, v))) return false;
      } else if (op === "$nin") {
        if (Array.isArray(val) && val.some(v => valueEquals(docVal, v))) return false;
      } else if (op === "$gt") {
        if (!(toComparableDate(docVal) > toComparableDate(val))) return false;
      } else if (op === "$gte") {
        if (!(toComparableDate(docVal) >= toComparableDate(val))) return false;
      } else if (op === "$lt") {
        if (!(toComparableDate(docVal) < toComparableDate(val))) return false;
      } else if (op === "$lte") {
        if (!(toComparableDate(docVal) <= toComparableDate(val))) return false;
      } else if (op === "$ne") {
        if (valueEquals(docVal, val)) return false;
      } else if (op === "$exists") {
        const exists = docVal !== undefined;
        if (Boolean(val) !== exists) return false;
      } else if (op === "$regex") {
        const re = new RegExp(val, cond.$options || "");
        if (!re.test(String(docVal == null ? "" : docVal))) return false;
      } else if (op === "$elemMatch") {
        if (!Array.isArray(docVal) || !docVal.some(el => matchesQuery({ el }, { el: val }) || matchesQuery(el && typeof el === "object" ? el : { value: el }, val))) return false;
      } else {
        // unknown operator: try deep equality fallback
        if (!valueEquals(docVal, cond)) return false;
      }
    }
    return true;
  }
  return valueEquals(docVal, cond);
}

function valueEquals(a, b) {
  if (a instanceof Date || b instanceof Date) {
    return toComparableDate(a) === toComparableDate(b);
  }
  if (a == null && b == null) return true;
  return String(a) === String(b) ? (typeof a === typeof b || a == b) : a == b;
}

function matchesQuery(doc, query) {
  if (!query || Object.keys(query).length === 0) return true;
  for (const [key, cond] of Object.entries(query)) {
    if (key === "$or") {
      if (!Array.isArray(cond) || !cond.some(q => matchesQuery(doc, q))) return false;
      continue;
    }
    if (key === "$and") {
      if (!Array.isArray(cond) || !cond.every(q => matchesQuery(doc, q))) return false;
      continue;
    }
    const docVal = key.includes(".") ? getByPath(doc, key) : doc[key];
    if (!matchCondition(docVal, cond)) return false;
  }
  return true;
}

function hasOperators(update) {
  return update && Object.keys(update).some(k => k.startsWith("$"));
}

function applyUpdate(doc, update, options = {}, isInsert = false) {
  if (!update) return doc;
  if (!hasOperators(update)) {
    // treat as $set
    for (const [k, v] of Object.entries(update)) {
      if (k === "_id") continue;
      setByPath(doc, k, deepClone(v));
    }
    return doc;
  }
  if (update.$setOnInsert && isInsert) {
    for (const [k, v] of Object.entries(update.$setOnInsert)) setByPath(doc, k, deepClone(v));
  }
  if (update.$set) {
    for (const [k, v] of Object.entries(update.$set)) setByPath(doc, k, deepClone(v));
  }
  if (update.$inc) {
    for (const [k, v] of Object.entries(update.$inc)) {
      const cur = getByPath(doc, k);
      setByPath(doc, k, (typeof cur === "number" ? cur : 0) + Number(v || 0));
    }
  }
  if (update.$push) {
    for (const [k, v] of Object.entries(update.$push)) {
      const cur = keyIncludesDot(k) ? getByPath(doc, k) : doc[k];
      let arr = Array.isArray(cur) ? cur : [];
      if (!Array.isArray(cur)) {
        if (k.includes(".")) setByPath(doc, k, arr);
        else doc[k] = arr;
      }
      if (v && typeof v === "object" && v.$each) {
        arr.push(...deepClone(v.$each));
      } else {
        arr.push(deepClone(v));
      }
    }
  }
  if (update.$addToSet) {
    for (const [k, v] of Object.entries(update.$addToSet)) {
      let arr = doc[k];
      if (!Array.isArray(arr)) { arr = []; doc[k] = arr; }
      const exists = arr.some(x => valueEquals(x, v));
      if (!exists) arr.push(deepClone(v));
    }
  }
  if (update.$unset) {
    for (const k of Object.keys(update.$unset)) {
      if (k.includes(".")) setByPath(doc, k, undefined);
      else delete doc[k];
    }
  }
  // $pull minimal support if ever needed
  if (update.$pull) {
    for (const [k, cond] of Object.entries(update.$pull)) {
      const arr = doc[k];
      if (Array.isArray(arr)) {
        doc[k] = arr.filter(item => {
          if (cond && typeof cond === "object" && !Array.isArray(cond) && !(cond instanceof RegExp)) {
            return !matchesQuery(item && typeof item === "object" ? item : { value: item }, cond);
          }
          return !valueEquals(item, cond);
        });
      }
    }
  }
  return doc;
}

function keyIncludesDot(k) { return String(k).includes("."); }

function makeDoc(data, collName) {
  const doc = data; // keep same reference as stored
  if (!doc._id) doc._id = uuidv4().replace(/-/g, "");
  if (typeof doc.save !== "function") {
    Object.defineProperty(doc, "save", {
      value: async function save() { return doc; },
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }
  if (typeof doc.toObject !== "function") {
    Object.defineProperty(doc, "toObject", {
      value: function toObject() { return deepClone(doc); },
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }
  if (typeof doc.toJSON !== "function") {
    Object.defineProperty(doc, "toJSON", {
      value: function toJSON() { return deepClone(doc); },
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }
  if (typeof doc.lean !== "function") {
    Object.defineProperty(doc, "lean", {
      value: function lean() { return deepClone(doc); },
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }
  return doc;
}

function createQuery(executor) {
  let lean = false;
  let select = null;
  let sortSpec = null;
  let limitN = null;
  const q = {
    lean() { lean = true; return q; },
    select() { return q; },
    sort(s) { sortSpec = s; return q; },
    limit(n) { limitN = n; return q; },
    skip() { return q; },
    exec: async () => executor({ lean, select, sortSpec, limitN }),
    then(resolve, reject) { return q.exec().then(resolve, reject); },
    catch(reject) { return q.exec().catch(reject); },
    finally(fn) { return q.exec().finally(fn); },
  };
  return q;
}

function wrapModel(MModel, collName) {
  const store = getStore();
  if (!store[collName]) store[collName] = [];
  const coll = () => getStore()[collName];

  const api = {
    __isMemoryWrapped: true,
    __collection: collName,
    modelName: MModel && MModel.modelName,

    findOne(query = {}) {
      if (isConnected()) return MModel.findOne(query);
      return createQuery(async ({ lean }) => {
        const found = coll().find(d => matchesQuery(d, query));
        if (!found) return null;
        if (lean) return deepClone(found);
        return makeDoc(found, collName);
      });
    },

    find(query = {}) {
      if (isConnected()) return MModel.find(query);
      return createQuery(async ({ lean }) => {
        let results = coll().filter(d => matchesQuery(d, query));
        // basic sort support if needed (not critical)
        if (lean) return results.map(d => deepClone(d));
        return results.map(d => makeDoc(d, collName));
      });
    },

    async create(obj) {
      if (isConnected()) return MModel.create(obj);
      if (Array.isArray(obj)) {
        return obj.map(o => api._insertOne(o));
      }
      return api._insertOne(obj);
    },

    _insertOne(obj) {
      const doc = deepClone(obj || {});
      if (!doc._id) doc._id = uuidv4().replace(/-/g, "");
      // basic created/updated timestamps for convenience
      const now = new Date();
      if (doc.createdAt === undefined) doc.createdAt = now;
      if (doc.updatedAt === undefined) doc.updatedAt = now;
      coll().push(doc);
      return makeDoc(doc, collName);
    },

    findOneAndUpdate(query = {}, update = {}, options = {}) {
      if (isConnected()) return MModel.findOneAndUpdate(query, update, options);
      return createQuery(async ({ lean }) => {
        let idx = coll().findIndex(d => matchesQuery(d, query));
        let doc = idx >= 0 ? coll()[idx] : null;
        let inserted = false;
        if (!doc && options.upsert) {
          doc = {};
          // apply query equality fields as base
          for (const [k, v] of Object.entries(query || {})) {
            if (k.startsWith("$")) continue;
            if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof RegExp)) {
              // operators in query - skip
              continue;
            }
            if (!(v instanceof RegExp)) doc[k] = deepClone(v);
          }
          applyUpdate(doc, update, options, true);
          if (!doc._id) doc._id = uuidv4().replace(/-/g, "");
          const now = new Date();
          if (doc.createdAt === undefined) doc.createdAt = now;
          if (doc.updatedAt === undefined) doc.updatedAt = now;
          coll().push(doc);
          idx = coll().length - 1;
          inserted = true;
        } else if (doc) {
          const oldClone = options.new ? null : deepClone(doc);
          applyUpdate(doc, update, options, false);
          doc.updatedAt = new Date();
          if (!options.new) {
            // return old doc by default for findOneAndUpdate
            if (lean) return oldClone;
            return makeDoc(oldClone, collName);
          }
        } else {
          return null;
        }
        const resultDoc = coll()[idx];
        if (lean) return deepClone(resultDoc);
        return makeDoc(resultDoc, collName);
      });
    },

    async updateOne(query = {}, update = {}, options = {}) {
      if (isConnected()) return MModel.updateOne(query, update, options);
      const idx = coll().findIndex(d => matchesQuery(d, query));
      if (idx === -1) {
        if (options.upsert) {
          const qres = await api.findOneAndUpdate(query, update, { ...options, upsert: true, new: true }).exec();
          return { acknowledged: true, matchedCount: 0, modifiedCount: qres ? 1 : 0, upsertedCount: 1, upsertedId: qres && qres._id };
        }
        return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      }
      applyUpdate(coll()[idx], update, options, false);
      coll()[idx].updatedAt = new Date();
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
    },

    async updateMany(query = {}, update = {}, options = {}) {
      if (isConnected()) return MModel.updateMany(query, update, options);
      let matched = 0;
      for (const doc of coll()) {
        if (matchesQuery(doc, query)) {
          applyUpdate(doc, update, options, false);
          doc.updatedAt = new Date();
          matched++;
        }
      }
      if (matched === 0 && options.upsert) {
        await api.findOneAndUpdate(query, update, { ...options, upsert: true, new: true }).exec();
        return { acknowledged: true, matchedCount: 0, modifiedCount: 1, upsertedCount: 1 };
      }
      return { acknowledged: true, matchedCount: matched, modifiedCount: matched, upsertedCount: 0 };
    },

    async deleteOne(query = {}) {
      if (isConnected()) return MModel.deleteOne(query);
      const idx = coll().findIndex(d => matchesQuery(d, query));
      if (idx === -1) return { acknowledged: true, deletedCount: 0 };
      coll().splice(idx, 1);
      return { acknowledged: true, deletedCount: 1 };
    },

    async deleteMany(query = {}) {
      if (isConnected()) return MModel.deleteMany(query);
      const before = coll().length;
      const keep = coll().filter(d => !matchesQuery(d, query));
      getStore()[collName] = keep;
      return { acknowledged: true, deletedCount: before - keep.length };
    },

    async countDocuments(query = {}) {
      if (isConnected()) return MModel.countDocuments(query);
      return coll().filter(d => matchesQuery(d, query)).length;
    },

    async exists(query = {}) {
      if (isConnected()) return MModel.exists(query);
      const found = coll().find(d => matchesQuery(d, query));
      return found ? { _id: found._id } : null;
    },
  };

  return api;
}

module.exports = { isConnected, wrapModel, getStore, matchesQuery, deepClone };