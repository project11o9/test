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

const JWT_SECRET = process.env.JWT_SECRET || "fidelity-secret-key-2024";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.set('trust proxy', 1);
  app.use(cors({
    origin: true,
    credentials: true
  }));
  app.use(express.json());
  app.use(cookieParser());

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

  const isAdmin = (req: any, res: any, next: any) => {
    if (req.user && req.user.role === 'admin') {
      next();
    } else {
      res.status(403).json({ error: "Admin access required" });
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

  // Auth: Register
  app.post("/api/auth/register", async (req, res) => {
    const { name, email, password, phone } = req.body;
    console.log(`Register attempt: ${email}`);
    try {
      const userRef = db.collection("users").where("email", "==", email);
      const snapshot = await userRef.get();
      if (!snapshot.empty) {
        console.log(`Register failed: User ${email} already exists`);
        return res.status(400).json({ error: "User already exists" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const newUser = {
        name,
        email,
        password: hashedPassword,
        phone: phone || "",
        wallet_balance: 0,
        credit_score: 50,
        kyc_status: "Pending",
        status: "Active",
        is_active: true,
        role: (email === "veerthakurma2002@gmail.com" || email === "adminhoon@fedility.com") ? "admin" : "user",
        createdAt: new Date().toISOString()
      };

      const docRef = await db.collection("users").add(newUser);
      const token = jwt.sign({ uid: docRef.id, email, role: newUser.role }, JWT_SECRET, { expiresIn: '7d' });
      
      console.log(`User registered successfully: ${email} (UID: ${docRef.id})`);
      res.cookie('token', token, { 
        httpOnly: true, 
        secure: true, 
        sameSite: 'none',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });
      res.json({ message: "User registered", token, user: { uid: docRef.id, ...newUser, password: undefined } });
    } catch (err) {
      console.error(`Register error for ${email}:`, err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Auth: Login
  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    console.log(`Login attempt: ${email}`);
    try {
      const snapshot = await db.collection("users").where("email", "==", email).get();
      if (snapshot.empty) {
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
        console.log(`Login failed: Invalid password for ${email}`);
        return res.status(401).json({ error: "Invalid password" });
      }

      if (userData.status === 'Blocked') {
        console.log(`Login failed: User ${email} is blocked`);
        return res.status(403).json({ error: "Account blocked" });
      }

      const token = jwt.sign({ uid: userDoc.id, email, role: userData.role }, JWT_SECRET, { expiresIn: '7d' });
      
      console.log(`User logged in successfully: ${email}`);
      res.cookie('token', token, { 
        httpOnly: true, 
        secure: true, 
        sameSite: 'none',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });
      res.json({ token, user: { uid: userDoc.id, ...userData, password: undefined } });
    } catch (err) {
      console.error(`Login error for ${email}:`, err);
      res.status(500).json({ error: (err as Error).message });
    }
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

  // Settings: Get Feature Flags
  app.get("/api/settings/features", async (req, res) => {
    try {
      const doc = await db.collection("settings").doc("features").get();
      res.json(doc.data() || {});
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Wallet: Deposit
  app.post("/api/deposit", authenticateToken, async (req: any, res) => {
    const { amount } = req.body;
    try {
      const deposit = {
        user_uid: req.user.uid,
        amount: parseFloat(amount),
        status: "Pending",
        timestamp: new Date().toISOString()
      };
      const docRef = await db.collection("deposits").add(deposit);
      res.json({ message: "Deposit request submitted", id: docRef.id });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Wallet: Withdraw
  app.post("/api/withdraw", authenticateToken, async (req: any, res) => {
    const { amount } = req.body;
    try {
      // Check balance
      const userDoc = await db.collection("users").doc(req.user.uid).get();
      const balance = userDoc.data()?.wallet_balance || 0;
      if (balance < amount) return res.status(400).json({ error: "Insufficient balance" });

      const withdraw = {
        user_uid: req.user.uid,
        amount: parseFloat(amount),
        status: "Pending",
        timestamp: new Date().toISOString()
      };
      const docRef = await db.collection("withdraws").add(withdraw);
      res.json({ message: "Withdraw request submitted", id: docRef.id });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Reviews: Submit
  app.post("/api/reviews/submit", authenticateToken, async (req: any, res) => {
    const { stockName, rating, commission } = req.body;
    try {
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

      res.json({ message: "Review submitted and commission added" });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Spin: Claim Reward
  app.post("/api/spin/claim", authenticateToken, async (req: any, res) => {
    const { reward } = req.body;
    try {
      if (reward <= 0) return res.json({ message: "No reward to claim" });

      const userRef = db.collection("users").doc(req.user.uid);
      
      await db.runTransaction(async (t) => {
        const userDoc = await t.get(userRef);
        const currentBalance = userDoc.data()?.wallet_balance || 0;
        
        // Update balance
        t.update(userRef, { wallet_balance: currentBalance + reward });
        
        // Add transaction
        const txRef = db.collection("transactions").doc();
        t.set(txRef, {
          user_uid: req.user.uid,
          type: "Spin Reward",
          amount: reward,
          status: "Completed",
          timestamp: new Date().toISOString()
        });
      });

      res.json({ message: "Spin reward claimed" });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // --- ADMIN ROUTES ---

  // Admin: Toggle User Active Status
  app.post("/api/admin/users/:uid/toggle-active", authenticateToken, isAdmin, async (req, res) => {
    const { uid } = req.params;
    const { is_active } = req.body;
    try {
      await db.collection("users").doc(uid).update({ is_active });
      res.json({ message: `User account ${is_active ? 'enabled' : 'disabled'}` });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Admin: Reset User Password
  app.post("/api/admin/users/:uid/reset-password", authenticateToken, isAdmin, async (req, res) => {
    const { uid } = req.params;
    const { newPassword } = req.body;
    try {
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await db.collection("users").doc(uid).update({ password: hashedPassword });
      res.json({ message: "User password reset successfully" });
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
