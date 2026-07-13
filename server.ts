import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Database Pool Connection
let pool: mysql.Pool | null = null;

function getDbPool() {
  if (!pool) {
    const host = process.env.DB_HOST;
    const port = process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306;
    const user = process.env.DB_USER;
    const password = process.env.DB_PASSWORD;
    const database = process.env.DB_NAME;

    if (!host || !user || !database) {
      console.warn("⚠️ Database connection environment variables are missing! Ensure your .env file is loaded.");
      return null;
    }

    pool = mysql.createPool({
      host,
      port,
      user,
      password,
      database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 10000 // 10 seconds timeout
    });
  }
  return pool;
}

// Automatically create table and seed data on startup
async function initDb() {
  const db = getDbPool();
  if (!db) {
    console.warn("⚠️ Could not connect to DB pool because credentials are not fully configured.");
    return;
  }

  try {
    console.log("🔄 Verifying MySQL connection and ensuring 'fin_user' table exists...");
    
    // Create 'fin_user' table if not exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS fin_user (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        department VARCHAR(100) NOT NULL,
        designation VARCHAR(100) NOT NULL,
        email VARCHAR(100) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        fingerprintId VARCHAR(3000) NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'Absent',
        avatar VARCHAR(500) NULL,
        joinedDate VARCHAR(50) NOT NULL
      )
    `);
    console.log("✅ MySQL: Table 'fin_user' verified successfully.");

    // Alter column size if table already exists to prevent truncation of base64 biometric templates
    await db.query(`
      ALTER TABLE fin_user MODIFY COLUMN fingerprintId VARCHAR(3000) NULL;
    `).catch(err => {
      console.log("ℹ️ fingerprintId might already be modified or cannot be altered:", err.message);
    });

    // Check if empty, and seed default values
    const [rows]: any = await db.query("SELECT COUNT(*) as count FROM fin_user");
    const count = rows[0]?.count || 0;

    if (count === 0) {
      console.log("🌱 MySQL: 'fin_user' table is empty. Seeding initial users...");
      const initialUsers = [
        {
          id: "EMP-101",
          name: "Anindo Roy",
          department: "Engineering",
          designation: "Senior Software Engineer",
          email: "anindo.roy@company.com",
          phone: "01712-345678",
          fingerprintId: "FP-101",
          status: "Present",
          joinedDate: "2024-01-15",
          avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200"
        },
        {
          id: "EMP-102",
          name: "Nabila Yasmin",
          department: "Human Resources",
          designation: "HR Manager",
          email: "nabila.yasmin@company.com",
          phone: "01811-234567",
          fingerprintId: "FP-102",
          status: "Present",
          joinedDate: "2024-03-10",
          avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=200"
        },
        {
          id: "EMP-103",
          name: "Tanvir Ahmed",
          department: "Marketing",
          designation: "Marketing Specialist",
          email: "tanvir.ahmed@company.com",
          phone: "01913-987654",
          fingerprintId: "FP-103",
          status: "Late",
          joinedDate: "2024-05-20",
          avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200"
        },
        {
          id: "EMP-104",
          name: "Ekta Rahman",
          department: "Finance",
          designation: "Senior Accountant",
          email: "ekta.rahman@company.com",
          phone: "01614-556677",
          fingerprintId: null,
          status: "Absent",
          joinedDate: "2025-02-01",
          avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&q=80&w=200"
        },
        {
          id: "EMP-105",
          name: "Srijon Dey",
          department: "Operations",
          designation: "Operations Executive",
          email: "srijon.dey@company.com",
          phone: "01515-443322",
          fingerprintId: "FP-105",
          status: "Present",
          joinedDate: "2024-11-12",
          avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=200"
        },
        {
          id: "EMP-106",
          name: "Tariqul Islam",
          department: "Engineering",
          designation: "QA Engineer",
          email: "tariqul.islam@company.com",
          phone: "01715-223344",
          fingerprintId: "FP-106",
          status: "Absent",
          joinedDate: "2025-01-10",
          avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&q=80&w=200"
        }
      ];

      for (const user of initialUsers) {
        await db.query(`
          INSERT INTO fin_user (id, name, department, designation, email, phone, fingerprintId, status, avatar, joinedDate)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          user.id,
          user.name,
          user.department,
          user.designation,
          user.email,
          user.phone,
          user.fingerprintId,
          user.status,
          user.avatar,
          user.joinedDate
        ]);
      }
      console.log("🌱 MySQL: Seeding completed. 6 users added.");
    }
  } catch (error) {
    console.error("❌ MySQL: Database initialization error:", error);
  }
}

// 🔌 API ENDPOINTS

// 1. Get all users
app.get('/api/users', async (req, res) => {
  const db = getDbPool();
  if (!db) {
    return res.status(500).json({ error: "MySQL database is not configured. Review server environmental credentials." });
  }
  try {
    const [rows] = await db.query('SELECT * FROM fin_user ORDER BY id ASC');
    res.json(rows);
  } catch (error: any) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: error.message });
  }
});

// 2. Add a new user
app.post('/api/users', async (req, res) => {
  const db = getDbPool();
  if (!db) {
    return res.status(500).json({ error: "MySQL database is not configured. Review server environmental credentials." });
  }
  try {
    const { id, name, department, designation, email, phone, fingerprintId, status, avatar, joinedDate } = req.body;
    
    if (!id || !name || !department || !designation || !email || !phone || !joinedDate) {
      return res.status(400).json({ error: "Missing required employee profile fields." });
    }

    await db.query(`
      INSERT INTO fin_user (id, name, department, designation, email, phone, fingerprintId, status, avatar, joinedDate)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, 
      name, 
      department, 
      designation, 
      email, 
      phone, 
      fingerprintId || null, 
      status || 'Absent', 
      avatar || null, 
      joinedDate
    ]);
    
    console.log(`👤 MySQL: User '${name}' (${id}) added successfully.`);
    res.status(201).json({ success: true, user: { id, name, department, designation, email, phone, fingerprintId, status, avatar, joinedDate } });
  } catch (error: any) {
    console.error("Error creating user:", error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Update a user
app.put('/api/users/:id', async (req, res) => {
  const db = getDbPool();
  if (!db) {
    return res.status(500).json({ error: "MySQL database is not configured. Review server environmental credentials." });
  }
  try {
    const { id } = req.params;
    const { name, department, designation, email, phone, fingerprintId, status, avatar, joinedDate } = req.body;
    
    const updates: string[] = [];
    const values: any[] = [];

    if (name !== undefined) { updates.push("name = ?"); values.push(name); }
    if (department !== undefined) { updates.push("department = ?"); values.push(department); }
    if (designation !== undefined) { updates.push("designation = ?"); values.push(designation); }
    if (email !== undefined) { updates.push("email = ?"); values.push(email); }
    if (phone !== undefined) { updates.push("phone = ?"); values.push(phone); }
    if (fingerprintId !== undefined) { updates.push("fingerprintId = ?"); values.push(fingerprintId); }
    if (status !== undefined) { updates.push("status = ?"); values.push(status); }
    if (avatar !== undefined) { updates.push("avatar = ?"); values.push(avatar); }
    if (joinedDate !== undefined) { updates.push("joinedDate = ?"); values.push(joinedDate); }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update in body payload." });
    }

    values.push(id);
    const [result]: any = await db.query(`
      UPDATE fin_user 
      SET ${updates.join(', ')} 
      WHERE id = ?
    `, values);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: `Employee user with ID '${id}' not found.` });
    }

    console.log(`✏️ MySQL: User '${id}' updated successfully.`);
    res.json({ success: true });
  } catch (error: any) {
    console.error("Error updating user:", error);
    res.status(500).json({ error: error.message });
  }
});

// 4. Delete a user
app.delete('/api/users/:id', async (req, res) => {
  const db = getDbPool();
  if (!db) {
    return res.status(500).json({ error: "MySQL database is not configured. Review server environmental credentials." });
  }
  try {
    const { id } = req.params;
    const [result]: any = await db.query('DELETE FROM fin_user WHERE id = ?', [id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: `Employee user with ID '${id}' not found.` });
    }

    console.log(`❌ MySQL: User '${id}' deleted successfully.`);
    res.json({ success: true });
  } catch (error: any) {
    console.error("Error deleting user:", error);
    res.status(500).json({ error: error.message });
  }
});

// Serve frontend build and handle routing
async function startServer() {
  await initDb();

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}

startServer();
