import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import cors from "cors";
import path from "path";
import fs from "fs";

const db = new Database("attendance.db");

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    descriptor TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT NOT NULL,
    period INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use('/images', express.static(path.join(process.cwd(), 'images')));

  // API Routes
  app.get("/api/images", (req, res) => {
    const imagesDir = path.join(process.cwd(), 'images');
    if (!fs.existsSync(imagesDir)) return res.json([]);
    
    const files = fs.readdirSync(imagesDir)
      .filter(f => /\.(jpg|jpeg|png)$/i.test(f));
    res.json(files);
  });
  app.get("/api/users", (req, res) => {
    const users = db.prepare("SELECT * FROM users").all();
    res.json(users);
  });

  app.post("/api/register", (req, res) => {
    const { name, descriptor } = req.body;
    if (!name || !descriptor) {
      return res.status(400).json({ error: "Name and face descriptor are required" });
    }
    const result = db.prepare("INSERT INTO users (name, descriptor) VALUES (?, ?)").run(name, JSON.stringify(descriptor));
    res.json({ id: result.lastInsertRowid, name });
  });

  app.post("/api/attendance", (req, res) => {
    const { userId, name } = req.body;
    
    // Calculate current period (Assuming 8 classes starting from 9:00 AM)
    const now = new Date();
    const startHour = 9;
    const currentHour = now.getHours();
    
    let period = -1;
    if (currentHour >= startHour && currentHour < startHour + 8) {
      period = currentHour - startHour + 1;
    } else {
      // If outside 9-5, we can either reject or mark as period 0/9
      // For now, let's allow it but check for 1 hour cooldown if outside schedule
      period = 0; 
    }

    // Check if already marked for THIS specific period today
    const today = now.toISOString().split('T')[0];
    const lastRecord = db.prepare(`
      SELECT * FROM attendance 
      WHERE name = ? 
      AND period = ? 
      AND date(timestamp) = date(?)
    `).get(name, period, today);
    
    if (lastRecord && period !== 0) {
      return res.json({ message: `Attendance already marked for Class ${period}`, alreadyMarked: true });
    }

    // If outside schedule (period 0), still use 1 hour cooldown
    if (period === 0) {
      const recentRecord = db.prepare("SELECT * FROM attendance WHERE name = ? AND timestamp > datetime('now', '-1 hour')").get(name);
      if (recentRecord) {
        return res.json({ message: "Attendance already marked recently", alreadyMarked: true });
      }
    }

    const result = db.prepare("INSERT INTO attendance (user_id, name, period) VALUES (?, ?, ?)").run(userId || null, name, period);
    res.json({ id: result.lastInsertRowid, name, period, timestamp: now.toISOString() });
  });

  app.get("/api/attendance", (req, res) => {
    const records = db.prepare("SELECT * FROM attendance ORDER BY timestamp DESC").all();
    res.json(records);
  });

  app.get("/api/export", (req, res) => {
    const records = db.prepare("SELECT name, period, timestamp FROM attendance ORDER BY timestamp DESC").all();
    let csv = "Name,Class Period,Timestamp\n";
    records.forEach(r => {
      csv += `${r.name},${r.period === 0 ? 'Outside Schedule' : 'Class ' + r.period},${r.timestamp}\n`;
    });
    res.header('Content-Type', 'text/csv');
    res.attachment('attendance.csv');
    res.send(csv);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
