import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import cors from "cors";
import cookieParser from "cookie-parser";
import fs from "fs";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin
const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
let firebaseConfig = { projectId: "" };
if (fs.existsSync(firebaseConfigPath)) {
  try {
    firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf8"));
    console.log("Firebase config loaded for project:", firebaseConfig.projectId);
  } catch (e) {
    console.error("Failed to parse firebase-applet-config.json:", e);
  }
} else {
  console.warn("firebase-applet-config.json not found");
}

if (firebaseConfig.projectId) {
  try {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: firebaseConfig.projectId,
    });
    console.log("Firebase Admin initialized successfully");
  } catch (e) {
    console.error("Firebase Admin initialization failed:", e);
  }
}

const db = admin.firestore();

// Set settings for Firestore
try {
  db.settings({ ignoreUndefinedProperties: true });
} catch (e) {
  console.error("Failed to set Firestore settings:", e);
}

const ENV_PROFILE = process.env.APP_ENV || process.env.NODE_ENV || "development";
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is required. Refusing to start with an insecure default secret.");
}
if (!["development", "test", "staging", "production"].includes(ENV_PROFILE)) {
  throw new Error(`Invalid APP_ENV/NODE_ENV profile: ${ENV_PROFILE}`);
}

const ADMIN_EMAILS = new Set([
  "veerthakurma2002@gmail.com",
  "adminhoon@fedility.com",
]);

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
};

const toPendingStatus = () => "pending";
const isValidDecision = (value: unknown): value is "approved" | "rejected" =>
  value === "approved" || value === "rejected";

const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

type SimpleSchema = {
  required?: string[];
  properties?: Record<string, "string" | "number" | "boolean">;
};

const validateBySchema = (schema: SimpleSchema, payload: any) => {
  const errors: string[] = [];
  const data = payload || {};
  (schema.required || []).forEach((key) => {
    if (data[key] === undefined || data[key] === null || data[key] === "") {
      errors.push(`${key} is required`);
    }
  });
  Object.entries(schema.properties || {}).forEach(([key, type]) => {
    if (data[key] === undefined || data[key] === null) return;
    if (type === "number" && Number.isNaN(Number(data[key]))) errors.push(`${key} must be number`);
    if (type === "boolean" && typeof data[key] !== "boolean") errors.push(`${key} must be boolean`);
    if (type === "string" && typeof data[key] !== "string") errors.push(`${key} must be string`);
  });
  return errors;
};

const Schemas = {
  register: { required: ["name", "email", "password"], properties: { name: "string", email: "string", password: "string" } } as SimpleSchema,
  login: { required: ["email", "password"], properties: { email: "string", password: "string" } } as SimpleSchema,
  depositWithdraw: { required: ["amount"], properties: { amount: "number" } } as SimpleSchema,
  decision: { required: ["decision"], properties: { decision: "string" } } as SimpleSchema,
};

export async function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(cors({
    origin: true,
    credentials: true
  }));
  app.use(express.json());
  app.use(cookieParser());

  app.use((req: any, res, next) => {
    req.requestId = crypto.randomUUID();
    res.setHeader("x-request-id", req.requestId);
    const start = Date.now();
    res.on("finish", () => {
      console.log(JSON.stringify({
        level: "info",
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Date.now() - start,
      }));
    });
    next();
  });

  const isSecureCookie = ENV_PROFILE === "production" || ENV_PROFILE === "staging";
  const sameSitePolicy = isSecureCookie ? "none" : "lax";
  const issueCsrfToken = () => crypto.randomBytes(24).toString("hex");
  const requireCsrf = (req: any, res: any, next: any) => {
    const headerToken = req.headers["x-csrf-token"];
    const cookieToken = req.cookies.csrf_token;
    if (!headerToken || !cookieToken || headerToken !== cookieToken) {
      return res.status(403).json({ error: "CSRF validation failed" });
    }
    const origin = req.headers.origin as string | undefined;
    const referer = req.headers.referer as string | undefined;
    const host = req.headers.host as string | undefined;
    const sameOrigin = (value?: string) => {
      if (!value || !host) return true;
      try {
        const parsed = new URL(value);
        return parsed.host === host;
      } catch {
        return false;
      }
    };
    if (!sameOrigin(origin) || !sameOrigin(referer)) {
      return res.status(403).json({ error: "CSRF origin check failed" });
    }
    next();
  };

  const getLoginAttempt = async (key: string) => {
    const ref = db.collection("login_attempts").doc(key);
    const snap = await ref.get();
    return { ref, data: snap.exists ? (snap.data() as any) : null };
  };

  const registerFailedAttempt = async (key: string) => {
    const { ref, data } = await getLoginAttempt(key);
    const nextCount = Number(data?.count || 0) + 1;
    const lockedUntil = nextCount >= LOGIN_ATTEMPT_LIMIT ? Date.now() + LOGIN_LOCK_MS : null;
    await ref.set({
      count: nextCount,
      lockedUntil,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    return { count: nextCount, lockedUntil };
  };

  const clearAttempts = async (key: string) => {
    await db.collection("login_attempts").doc(key).delete().catch(() => undefined);
  };

  const withIdempotency = async (req: any, action: string, handler: () => Promise<any>) => {
    const key = req.headers["x-idempotency-key"];
    if (!key || typeof key !== "string") {
      return { error: { status: 400, body: { error: "x-idempotency-key header required" } } };
    }
    const docId = `${action}:${key}`;
    const ref = db.collection("idempotency_keys").doc(docId);
    const now = Date.now();
    const existing = await ref.get();
    if (existing.exists) {
      const data = existing.data() as any;
      if (data.expiresAt && now < data.expiresAt) {
        return { replay: data.response };
      }
    }
    const response = await handler();
    await ref.set({
      action,
      response,
      createdAt: new Date().toISOString(),
      expiresAt: now + IDEMPOTENCY_TTL_MS
    });
    return { response };
  };

  // --- AUTH MIDDLEWARE ---
  const authenticateToken = async (req: any, res: any, next: any) => {
    const token = req.cookies.token || req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    jwt.verify(token, JWT_SECRET, async (err: any, decoded: any) => {
      if (err) return res.status(403).json({ error: "Forbidden" });
      
      try {
        const userDoc = await db.collection("users").doc(decoded.uid).get();
        if (!userDoc.exists || userDoc.data()?.is_active === false) {
          return res.status(403).json({ error: "Account disabled or not found" });
        }
        req.user = decoded;
        next();
      } catch (e) {
        res.status(500).json({ error: "Internal server error" });
      }
    });
  };

  const authenticateFirebaseAdmin = async (req: any, res: any, next: any) => {
    const bearer = req.headers['authorization']?.split(' ')[1];
    if (!bearer) return res.status(401).json({ error: "Unauthorized" });
    try {
      const decoded = await admin.auth().verifyIdToken(bearer);
      const userDoc = await db.collection("users").doc(decoded.uid).get();
      const role = userDoc.data()?.role;
      if (role !== "admin") return res.status(403).json({ error: "Admin access required" });
      req.admin = { uid: decoded.uid, email: decoded.email };
      next();
    } catch (e) {
      return res.status(403).json({ error: "Forbidden" });
    }
  };

  const writeAuditLog = async (entry: any) => {
    try {
      await db.collection("audit_logs").add({
        ...entry,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.error("Failed to write audit log", e);
    }
  };

  // --- API ROUTES ---

  // Health Check
  app.get("/api/health", async (req, res) => {
    let firestoreStatus = "unknown";
    try {
      if (firebaseConfig.projectId) {
        await db.collection("health").doc("check").set({ lastCheck: new Date().toISOString() });
        firestoreStatus = "connected";
      } else {
        firestoreStatus = "not_configured";
      }
    } catch (e) {
      firestoreStatus = "error: " + (e as Error).message;
    }
    res.json({ 
      status: "ok", 
      firebase: !!firebaseConfig.projectId,
      firestore: firestoreStatus,
      env: process.env.NODE_ENV || "development"
    });
  });

  app.get("/api/openapi", async (req, res) => {
    const openApiPath = path.join(process.cwd(), "openapi.json");
    if (!fs.existsSync(openApiPath)) {
      return res.status(404).json({ error: "OpenAPI contract not found" });
    }
    res.sendFile(openApiPath);
  });

  // Auth: Register
  app.post("/api/auth/register", async (req, res) => {
    const { name, dob, email, password, phone } = req.body;
    const registerErrors = validateBySchema(Schemas.register, req.body);
    if (registerErrors.length) return res.status(400).json({ error: registerErrors.join(", ") });
    console.log(`Register attempt: ${email}`);
    try {
      const userRef = db.collection("users").where("email", "==", email);
      const snapshot = await userRef.get();
      if (!snapshot.empty) {
        console.log(`Register failed: User ${email} already exists`);
        return res.status(400).json({ error: "User already exists" });
      }

      if (!name || !email || !password) {
        return res.status(400).json({ error: "name, email and password are required" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const userDocRef = db.collection("users").doc();
      const newUser = {
        uid: userDocRef.id,
        name,
        email,
        password: hashedPassword,
        phone: phone || "",
        dob: dob || "",
        wallet_balance: 0,
        credit_score: 50,
        kyc_status: "Pending",
        status: "Active",
        is_active: true,
        role: ADMIN_EMAILS.has(email) ? "admin" : "user",
        createdAt: new Date().toISOString()
      };

      await userDocRef.set(newUser);
      const token = jwt.sign({ uid: userDocRef.id, email, role: newUser.role }, JWT_SECRET, { expiresIn: '7d' });
      
      console.log(`User registered successfully: ${email} (UID: ${userDocRef.id})`);
      res.cookie('token', token, { 
        httpOnly: true, 
        secure: isSecureCookie, 
        sameSite: sameSitePolicy as any,
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });
      const csrfToken = issueCsrfToken();
      res.cookie("csrf_token", csrfToken, {
        httpOnly: false,
        secure: isSecureCookie,
        sameSite: sameSitePolicy as any,
        maxAge: 7 * 24 * 60 * 60 * 1000
      });
      res.json({ message: "User registered", csrfToken, user: { ...newUser, password: undefined } });
    } catch (err) {
      console.error(`Register error for ${email}:`, err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Auth: Login
  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    const loginErrors = validateBySchema(Schemas.login, req.body);
    if (loginErrors.length) return res.status(400).json({ error: loginErrors.join(", ") });
    const attemptKey = `${req.ip}:${String(email || "").toLowerCase()}`;
    const { data: attemptState } = await getLoginAttempt(attemptKey);
    if (attemptState?.lockedUntil && Date.now() < Number(attemptState.lockedUntil)) {
      return res.status(429).json({ error: "Too many failed attempts. Try again later." });
    }
    console.log(`Login attempt: ${email}`);
    try {
      const snapshot = await db.collection("users").where("email", "==", email).get();
      if (snapshot.empty) {
        await registerFailedAttempt(attemptKey);
        console.log(`Login failed: User ${email} not found`);
        return res.status(404).json({ error: "User not found" });
      }

      const userDoc = snapshot.docs[0];
      const userData = userDoc.data();

      if (userData.is_active === false) {
        console.log(`Login failed: User ${email} is disabled`);
        return res.status(403).json({ error: "Account disabled. Please contact support." });
      }

      const validPassword = await bcrypt.compare(password, userData.password);
      if (!validPassword) {
        await registerFailedAttempt(attemptKey);
        console.log(`Login failed: Invalid password for ${email}`);
        return res.status(401).json({ error: "Invalid password" });
      }

      if (userData.status === 'Blocked') {
        console.log(`Login failed: User ${email} is blocked`);
        return res.status(403).json({ error: "Account blocked" });
      }

      const token = jwt.sign({ uid: userDoc.id, email, role: userData.role }, JWT_SECRET, { expiresIn: '7d' });
      await clearAttempts(attemptKey);
      
      console.log(`User logged in successfully: ${email}`);
      res.cookie('token', token, { 
        httpOnly: true, 
        secure: isSecureCookie, 
        sameSite: sameSitePolicy as any,
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });
      const csrfToken = issueCsrfToken();
      res.cookie("csrf_token", csrfToken, {
        httpOnly: false,
        secure: isSecureCookie,
        sameSite: sameSitePolicy as any,
        maxAge: 7 * 24 * 60 * 60 * 1000
      });
      res.json({ csrfToken, user: { uid: userDoc.id, ...userData, password: undefined } });
    } catch (err) {
      console.error(`Login error for ${email}:`, err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/auth/logout", requireCsrf, async (req, res) => {
    res.clearCookie("token", {
      httpOnly: true,
      secure: isSecureCookie,
      sameSite: sameSitePolicy as any,
    });
    res.clearCookie("csrf_token", {
      httpOnly: false,
      secure: isSecureCookie,
      sameSite: sameSitePolicy as any,
    });
    res.json({ message: "Logged out" });
  });

  app.get("/api/auth/csrf", authenticateToken, async (req, res) => {
    const csrfToken = issueCsrfToken();
    res.cookie("csrf_token", csrfToken, {
      httpOnly: false,
      secure: isSecureCookie,
      sameSite: sameSitePolicy as any,
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    res.json({ csrfToken });
  });

  // User Profile
  app.get("/api/user/profile", authenticateToken, async (req: any, res) => {
    try {
      const doc = await db.collection("users").doc(req.user.uid).get();
      if (!doc.exists) return res.status(404).json({ error: "User not found" });
      res.json(doc.data());
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Wallet: Get Balance & History
  app.get("/api/wallet", authenticateToken, async (req: any, res) => {
    try {
      const userDoc = await db.collection("users").doc(req.user.uid).get();
      const transactions = await db.collection("transactions")
        .where("user_uid", "==", req.user.uid)
        .orderBy("timestamp", "desc")
        .get();
      
      res.json({
        balance: userDoc.data()?.wallet_balance || 0,
        transactions: transactions.docs.map(d => ({ id: d.id, ...d.data() }))
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Stocks: Get List
  app.get("/api/stocks", async (req, res) => {
    try {
      const snapshot = await db.collection("stocks").orderBy("order").get();
      res.json(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/stocks/feed", authenticateToken, async (req: any, res) => {
    try {
      const stocksSnapshot = await db.collection("stocks").orderBy("order").get();
      const baseStocks = stocksSnapshot.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

      const rulesSnapshot = await db.collection("injection_rules")
        .where("active", "==", true)
        .get();
      const rules = rulesSnapshot.docs
        .map(d => ({ id: d.id, ...d.data() } as any))
        .filter(r => !r.target_uid || r.target_uid === req.user.uid)
        .sort((a, b) => Number(a.position) - Number(b.position));

      const result = [...baseStocks];
      rules.forEach((rule) => {
        const stock = baseStocks.find(s => s.id === rule.stockId);
        if (!stock) return;
        const targetPos = Math.max(0, Math.min(result.length, Number(rule.position) - 1));
        result.splice(targetPos, 0, { ...stock, injected: true, injectionRuleId: rule.id });
      });

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Settings: Get Feature Flags
  app.get("/api/settings/features", async (req, res) => {
    try {
      const doc = await db.collection("settings").doc("features").get();
      res.json(doc.data() || {});
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/settings/spin", async (req, res) => {
    try {
      const doc = await db.collection("settings").doc("spin").get();
      res.json(doc.data() || {});
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Wallet: Deposit
  app.post("/api/deposit", authenticateToken, requireCsrf, async (req: any, res) => {
    const { amount } = req.body;
    const depositErrors = validateBySchema(Schemas.depositWithdraw, req.body);
    if (depositErrors.length) return res.status(400).json({ error: depositErrors.join(", ") });
    try {
      const idem = await withIdempotency(req, `user-deposit:${req.user.uid}`, async () => {
      const normalizedAmount = toNumber(amount);
      if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
        throw new Error("Valid deposit amount is required");
      }
      const deposit = {
        user_uid: req.user.uid,
        amount: normalizedAmount,
        status: toPendingStatus(),
        timestamp: new Date().toISOString()
      };
      const docRef = await db.collection("deposits").add(deposit);
      return { message: "Deposit request submitted", id: docRef.id };
      });
      if ((idem as any).error) return res.status((idem as any).error.status).json((idem as any).error.body);
      if ((idem as any).replay) return res.json({ ...(idem as any).replay, idempotentReplay: true });
      res.json((idem as any).response);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Wallet: Withdraw
  app.post("/api/withdraw", authenticateToken, requireCsrf, async (req: any, res) => {
    const { amount } = req.body;
    const withdrawErrors = validateBySchema(Schemas.depositWithdraw, req.body);
    if (withdrawErrors.length) return res.status(400).json({ error: withdrawErrors.join(", ") });
    try {
      const idem = await withIdempotency(req, `user-withdraw:${req.user.uid}`, async () => {
      const normalizedAmount = toNumber(amount);
      if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
        throw new Error("Valid withdrawal amount is required");
      }
      // Check balance
      const userDoc = await db.collection("users").doc(req.user.uid).get();
      const balance = userDoc.data()?.wallet_balance || 0;
      if (balance < normalizedAmount) return res.status(400).json({ error: "Insufficient balance" });

      const withdraw = {
        user_uid: req.user.uid,
        amount: normalizedAmount,
        status: toPendingStatus(),
        timestamp: new Date().toISOString()
      };
      const docRef = await db.collection("withdraws").add(withdraw);
      return { message: "Withdraw request submitted", id: docRef.id };
      });
      if ((idem as any).error) return res.status((idem as any).error.status).json((idem as any).error.body);
      if ((idem as any).replay) return res.json({ ...(idem as any).replay, idempotentReplay: true });
      res.json((idem as any).response);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Reviews: Submit
  app.post("/api/reviews/submit", authenticateToken, requireCsrf, async (req: any, res) => {
    const { stockName, rating } = req.body;
    try {
      const numericRating = toNumber(rating);
      if (!stockName || !Number.isFinite(numericRating) || numericRating < 1 || numericRating > 5) {
        return res.status(400).json({ error: "stockName and rating (1-5) are required" });
      }

      const commission = numericRating === 5 ? 300 : numericRating === 4 ? 200 : 0;
      if (commission <= 0) {
        return res.status(400).json({ error: "Minimum 4-star rating required for commission" });
      }

      const userRef = db.collection("users").doc(req.user.uid);
      
      await db.runTransaction(async (t) => {
        const userDoc = await t.get(userRef);
        const currentBalance = userDoc.data()?.wallet_balance || 0;
        
        // Update balance
        t.update(userRef, { wallet_balance: currentBalance + commission });
        
        // Add transaction
        const txRef = db.collection("transactions").doc();
        t.set(txRef, {
          user_uid: req.user.uid,
          type: "Commission",
          stock: stockName,
          amount: commission,
          status: "Completed",
          timestamp: new Date().toISOString()
        });
      });

      res.json({ message: "Review submitted and commission added", commission });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Spin: Claim Reward
  app.post("/api/spin/claim", authenticateToken, requireCsrf, async (req: any, res) => {
    const { reward } = req.body;
    try {
      const normalizedReward = toNumber(reward);
      if (!Number.isFinite(normalizedReward) || normalizedReward <= 0) {
        return res.json({ message: "No reward to claim" });
      }

      const userRef = db.collection("users").doc(req.user.uid);
      
      await db.runTransaction(async (t) => {
        const userDoc = await t.get(userRef);
        const currentBalance = userDoc.data()?.wallet_balance || 0;
        
        // Update balance
        t.update(userRef, { wallet_balance: currentBalance + normalizedReward });
        
        // Add transaction
        const txRef = db.collection("transactions").doc();
        t.set(txRef, {
          user_uid: req.user.uid,
          type: "Spin Reward",
          amount: normalizedReward,
          status: "Completed",
          timestamp: new Date().toISOString()
        });
      });

      res.json({ message: "Spin reward claimed", reward: normalizedReward });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // --- ADMIN ROUTES ---

  // Admin: Toggle User Active Status
  app.post("/api/admin/users/:uid/toggle-active", authenticateFirebaseAdmin, async (req: any, res) => {
    const { uid } = req.params;
    const { is_active } = req.body;
    try {
      await db.collection("users").doc(uid).update({ is_active });
      await writeAuditLog({ action: "toggle-user-active", admin_uid: req.admin.uid, target_uid: uid, is_active });
      res.json({ message: `User account ${is_active ? 'enabled' : 'disabled'}` });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Admin: Reset User Password
  app.post("/api/admin/users/:uid/reset-password", authenticateFirebaseAdmin, async (req: any, res) => {
    const { uid } = req.params;
    const { newPassword } = req.body;
    try {
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await db.collection("users").doc(uid).update({ password: hashedPassword });
      await writeAuditLog({ action: "reset-password", admin_uid: req.admin.uid, target_uid: uid });
      res.json({ message: "User password reset successfully" });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/admin/deposits/:id/decision", authenticateFirebaseAdmin, async (req: any, res) => {
    const { id } = req.params;
    const { decision } = req.body;
    const decisionErrors = validateBySchema(Schemas.decision, req.body);
    if (decisionErrors.length) return res.status(400).json({ error: decisionErrors.join(", ") });
    if (!isValidDecision(decision)) {
      return res.status(400).json({ error: "decision must be approved or rejected" });
    }

    try {
      const idem = await withIdempotency(req, `deposit-decision:${id}`, async () => {
      const depositRef = db.collection("deposits").doc(id);
      await db.runTransaction(async (t) => {
        const depositDoc = await t.get(depositRef);
        if (!depositDoc.exists) throw new Error("Deposit request not found");
        const deposit = depositDoc.data() as any;
        if (deposit.status !== "pending") throw new Error("Deposit already processed");

        t.update(depositRef, {
          status: decision,
          reviewed_by: req.admin.uid,
          reviewed_at: new Date().toISOString(),
        });

        if (decision === "approved") {
          const userRef = db.collection("users").doc(deposit.user_uid);
          const userDoc = await t.get(userRef);
          const currentBalance = userDoc.data()?.wallet_balance || 0;
          t.update(userRef, { wallet_balance: currentBalance + Number(deposit.amount) });

          const txRef = db.collection("transactions").doc();
          t.set(txRef, {
            user_uid: deposit.user_uid,
            type: "Deposit",
            amount: Number(deposit.amount),
            status: "Completed",
            timestamp: new Date().toISOString(),
          });
        }
      });
      await writeAuditLog({ action: "deposit-decision", admin_uid: req.admin.uid, request_id: id, decision });
      return { message: `Deposit ${decision}` };
      });
      if ((idem as any).error) return res.status((idem as any).error.status).json((idem as any).error.body);
      if ((idem as any).replay) return res.json({ ...(idem as any).replay, idempotentReplay: true });
      res.json((idem as any).response);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/admin/withdraws/:id/decision", authenticateFirebaseAdmin, async (req: any, res) => {
    const { id } = req.params;
    const { decision } = req.body;
    const decisionErrors = validateBySchema(Schemas.decision, req.body);
    if (decisionErrors.length) return res.status(400).json({ error: decisionErrors.join(", ") });
    if (!isValidDecision(decision)) {
      return res.status(400).json({ error: "decision must be approved or rejected" });
    }

    try {
      const idem = await withIdempotency(req, `withdraw-decision:${id}`, async () => {
      const withdrawRef = db.collection("withdraws").doc(id);
      await db.runTransaction(async (t) => {
        const withdrawDoc = await t.get(withdrawRef);
        if (!withdrawDoc.exists) throw new Error("Withdraw request not found");
        const withdraw = withdrawDoc.data() as any;
        if (withdraw.status !== "pending") throw new Error("Withdraw already processed");

        const userRef = db.collection("users").doc(withdraw.user_uid);
        const userDoc = await t.get(userRef);
        const currentBalance = userDoc.data()?.wallet_balance || 0;

        if (decision === "approved" && currentBalance < Number(withdraw.amount)) {
          throw new Error("Insufficient balance for withdrawal approval");
        }

        t.update(withdrawRef, {
          status: decision,
          reviewed_by: req.admin.uid,
          reviewed_at: new Date().toISOString(),
        });

        if (decision === "approved") {
          t.update(userRef, { wallet_balance: currentBalance - Number(withdraw.amount) });

          const txRef = db.collection("transactions").doc();
          t.set(txRef, {
            user_uid: withdraw.user_uid,
            type: "Withdraw",
            amount: Number(withdraw.amount),
            status: "Completed",
            timestamp: new Date().toISOString(),
          });
        }
      });
      await writeAuditLog({ action: "withdraw-decision", admin_uid: req.admin.uid, request_id: id, decision });
      return { message: `Withdraw ${decision}` };
      });
      if ((idem as any).error) return res.status((idem as any).error.status).json((idem as any).error.body);
      if ((idem as any).replay) return res.json({ ...(idem as any).replay, idempotentReplay: true });
      res.json((idem as any).response);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/admin/settings/spin", authenticateFirebaseAdmin, async (req: any, res) => {
    const { enabled, rewards } = req.body || {};
    if (typeof enabled !== "boolean" || !Array.isArray(rewards)) {
      return res.status(400).json({ error: "enabled(boolean) and rewards(array) are required" });
    }
    try {
      await db.collection("settings").doc("spin").set({
        enabled,
        rewards,
        updated_at: new Date().toISOString(),
        updated_by: req.admin.uid,
      }, { merge: true });
      await writeAuditLog({ action: "update-spin-settings", admin_uid: req.admin.uid, enabled, rewards_count: rewards.length });
      res.json({ message: "Spin settings updated" });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/admin/injection-rules", authenticateFirebaseAdmin, async (req: any, res) => {
    const { stockId, position, target_uid, active = true } = req.body || {};
    if (!stockId || !Number.isFinite(toNumber(position))) {
      return res.status(400).json({ error: "stockId and numeric position are required" });
    }
    try {
      const docRef = await db.collection("injection_rules").add({
        stockId,
        position: Number(position),
        target_uid: target_uid || null,
        active: Boolean(active),
        created_at: new Date().toISOString(),
        created_by: req.admin.uid,
      });
      await writeAuditLog({ action: "create-injection-rule", admin_uid: req.admin.uid, rule_id: docRef.id });
      res.json({ message: "Injection rule saved", id: docRef.id });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/admin/reconcile/user/:uid", authenticateFirebaseAdmin, async (req: any, res) => {
    const { uid } = req.params;
    try {
      const txSnapshot = await db.collection("transactions").where("user_uid", "==", uid).get();
      let computedBalance = 0;
      txSnapshot.docs.forEach((doc) => {
        const tx = doc.data() as any;
        const amount = Number(tx.amount || 0);
        const debit = tx.type === "Withdraw";
        computedBalance += debit ? -amount : amount;
      });
      await db.collection("users").doc(uid).set({
        wallet_balance: computedBalance,
        reconciled_at: new Date().toISOString(),
        reconciled_by: req.admin.uid
      }, { merge: true });
      await writeAuditLog({ action: "reconcile-user-wallet", admin_uid: req.admin.uid, target_uid: uid, computedBalance });
      res.json({ message: "User wallet reconciled", computedBalance, transactions: txSnapshot.size });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/admin/idempotency/cleanup", authenticateFirebaseAdmin, async (req: any, res) => {
    try {
      const now = Date.now();
      const snapshot = await db.collection("idempotency_keys").where("expiresAt", "<", now).get();
      const batch = db.batch();
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      await writeAuditLog({ action: "idempotency-cleanup", admin_uid: req.admin.uid, deleted: snapshot.size });
      res.json({ message: "Idempotency cleanup complete", deleted: snapshot.size });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/admin/audit-logs/export", authenticateFirebaseAdmin, async (req: any, res) => {
    const limitRaw = Number(req.query.limit || 500);
    const safeLimit = Math.max(1, Math.min(1000, limitRaw));
    const actionFilter = String(req.query.action || "").trim();
    try {
      let q: FirebaseFirestore.Query = db.collection("audit_logs").orderBy("timestamp", "desc").limit(safeLimit);
      if (actionFilter) {
        q = db.collection("audit_logs")
          .where("action", "==", actionFilter)
          .orderBy("timestamp", "desc")
          .limit(safeLimit);
      }
      const snapshot = await q.get();
      const rows = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      const headers = ["timestamp", "action", "admin_uid", "target_uid", "request_id"];
      const csv = [headers, ...rows.map((r: any) => headers.map((h) => r[h] ?? ""))]
        .map((r) => r.map((v) => `\"${String(v).replace(/\"/g, '\"\"')}\"`).join(","))
        .join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=\"audit-logs-${Date.now()}.csv\"`);
      res.send(csv);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Global Error Handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error("Global Error Handler:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  });

  // --- STATIC FILES ---
  app.use(express.static(path.join(process.cwd(), "public")));

  // --- VITE MIDDLEWARE ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "custom", // Use custom to handle routing ourselves
    });
    
    app.use(vite.middlewares);

    app.get('/admin', async (req, res, next) => {
      try {
        let html = fs.readFileSync(path.resolve(process.cwd(), 'admin.html'), 'utf-8');
        html = await vite.transformIndexHtml(req.originalUrl, html);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (e) {
        next(e);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('/admin', (req, res) => {
      res.sendFile(path.join(distPath, 'admin.html'));
    });
    app.get('*', (req, res) => {
      const publicPath = path.join(process.cwd(), 'public', req.path);
      if (fs.existsSync(publicPath) && fs.lstatSync(publicPath).isFile()) {
        res.sendFile(publicPath);
      } else {
        res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
      }
    });
  }

  return app;
}

async function startServer() {
  const PORT = 3000;
  const app = await createApp();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer();
}
