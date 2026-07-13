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

// In-memory fallback database for robustness when MySQL is not configured
let usersInMemoryDb: any[] = [
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
    avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200",
    fingers: [{ fingerName: "Right Index", templateData: "FP-101" }]
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
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=200",
    fingers: [{ fingerName: "Right Index", templateData: "FP-102" }]
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
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200",
    fingers: [{ fingerName: "Right Index", templateData: "FP-103" }]
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
    avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&q=80&w=200",
    fingers: []
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
    avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=200",
    fingers: [{ fingerName: "Right Index", templateData: "FP-105" }]
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
    avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&q=80&w=200",
    fingers: [{ fingerName: "Right Index", templateData: "FP-106" }]
  }
];

// Automatically create table and seed data on startup
async function initDb() {
  const db = getDbPool();
  if (!db) {
    console.warn("⚠️ Could not connect to DB pool because credentials are not fully configured. Using In-Memory fallback.");
    return;
  }

  try {
    console.log("🔄 Verifying MySQL connection and ensuring table structures exist...");
    
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

    // Create 'fin_fingerprints' table if not exists to store multiple fingerprints per profile
    await db.query(`
      CREATE TABLE IF NOT EXISTS fin_fingerprints (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId VARCHAR(50) NOT NULL,
        fingerName VARCHAR(50) NOT NULL,
        templateData VARCHAR(3000) NOT NULL,
        BMPBase64 MEDIUMTEXT NULL,
        ErrorCode INT NULL,
        ISOTemplateBase64 VARCHAR(3000) NULL,
        ImageDPI INT NULL,
        ImageDataBase64 MEDIUMTEXT NULL,
        ImageHeight INT NULL,
        ImageQuality INT NULL,
        ImageWidth INT NULL,
        Manufacturer VARCHAR(100) NULL,
        Model VARCHAR(100) NULL,
        NFIQ INT NULL,
        SerialNumber VARCHAR(100) NULL,
        TemplateBase64 VARCHAR(3000) NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_user_finger (userId, fingerName),
        FOREIGN KEY (userId) REFERENCES fin_user(id) ON DELETE CASCADE
      )
    `);
    console.log("✅ MySQL: Table 'fin_fingerprints' verified successfully.");

    // Gracefully execute alter statements for existing tables to avoid missing column errors
    await db.query(`ALTER TABLE fin_fingerprints MODIFY COLUMN BMPBase64 MEDIUMTEXT NULL`).catch(err => {
      console.log("ℹ️ Could not modify BMPBase64 column:", err.message);
    });
    await db.query(`ALTER TABLE fin_fingerprints ADD COLUMN ErrorCode INT NULL`).catch(() => {});
    await db.query(`ALTER TABLE fin_fingerprints ADD COLUMN ISOTemplateBase64 VARCHAR(3000) NULL`).catch(() => {});
    await db.query(`ALTER TABLE fin_fingerprints ADD COLUMN ImageDPI INT NULL`).catch(() => {});
    await db.query(`ALTER TABLE fin_fingerprints ADD COLUMN ImageDataBase64 MEDIUMTEXT NULL`).catch(() => {});
    await db.query(`ALTER TABLE fin_fingerprints ADD COLUMN ImageHeight INT NULL`).catch(() => {});
    await db.query(`ALTER TABLE fin_fingerprints ADD COLUMN ImageQuality INT NULL`).catch(() => {});
    await db.query(`ALTER TABLE fin_fingerprints ADD COLUMN ImageWidth INT NULL`).catch(() => {});
    await db.query(`ALTER TABLE fin_fingerprints ADD COLUMN Manufacturer VARCHAR(100) NULL`).catch(() => {});
    await db.query(`ALTER TABLE fin_fingerprints ADD COLUMN Model VARCHAR(100) NULL`).catch(() => {});
    await db.query(`ALTER TABLE fin_fingerprints ADD COLUMN NFIQ INT NULL`).catch(() => {});
    await db.query(`ALTER TABLE fin_fingerprints ADD COLUMN SerialNumber VARCHAR(100) NULL`).catch(() => {});
    await db.query(`ALTER TABLE fin_fingerprints ADD COLUMN TemplateBase64 VARCHAR(3000) NULL`).catch(() => {});

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

        if (user.fingerprintId) {
          await db.query(`
            INSERT INTO fin_fingerprints (userId, fingerName, templateData)
            VALUES (?, 'Right Index', ?)
          `, [user.id, user.fingerprintId]);
        }
      }
      console.log("🌱 MySQL: Seeding completed. 6 users added with fingers.");
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
    // In-memory fallback
    return res.json(usersInMemoryDb);
  }
  try {
    const [usersRows]: any = await db.query('SELECT * FROM fin_user ORDER BY id ASC');
    const [fingerprintsRows]: any = await db.query('SELECT * FROM fin_fingerprints');

    // Group fingerprints by userId
    const fingerprintsByUserId: Record<string, any[]> = {};
    for (const fp of fingerprintsRows) {
      if (!fingerprintsByUserId[fp.userId]) {
        fingerprintsByUserId[fp.userId] = [];
      }
      fingerprintsByUserId[fp.userId].push({
        fingerName: fp.fingerName,
        templateData: fp.templateData,
        BMPBase64: fp.BMPBase64,
        ErrorCode: fp.ErrorCode,
        ISOTemplateBase64: fp.ISOTemplateBase64,
        ImageDPI: fp.ImageDPI,
        ImageDataBase64: fp.ImageDataBase64,
        ImageHeight: fp.ImageHeight,
        ImageQuality: fp.ImageQuality,
        ImageWidth: fp.ImageWidth,
        Manufacturer: fp.Manufacturer,
        Model: fp.Model,
        NFIQ: fp.NFIQ,
        SerialNumber: fp.SerialNumber,
        TemplateBase64: fp.TemplateBase64
      });
    }

    // Attach fingers array to each user
    const usersWithFingers = usersRows.map((u: any) => ({
      ...u,
      fingers: fingerprintsByUserId[u.id] || []
    }));

    res.json(usersWithFingers);
  } catch (error: any) {
    console.error("Error fetching users from MySQL:", error);
    res.status(500).json({ error: error.message });
  }
});

// 2. Add a new user
app.post('/api/users', async (req, res) => {
  const { id, name, department, designation, email, phone, fingerprintId, status, avatar, joinedDate } = req.body;
  
  if (!id || !name || !department || !designation || !email || !phone || !joinedDate) {
    return res.status(400).json({ error: "Missing required employee profile fields." });
  }

  const db = getDbPool();
  if (!db) {
    // In-memory fallback
    const newUser = {
      id,
      name,
      department,
      designation,
      email,
      phone,
      fingerprintId: fingerprintId || null,
      status: status || 'Absent',
      avatar: avatar || null,
      joinedDate,
      fingers: fingerprintId ? [{ fingerName: "Right Index", templateData: fingerprintId }] : []
    };
    usersInMemoryDb.push(newUser);
    return res.status(201).json({ success: true, user: newUser });
  }

  try {
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
    
    if (fingerprintId) {
      await db.query(`
        INSERT INTO fin_fingerprints (userId, fingerName, templateData)
        VALUES (?, 'Right Index', ?)
        ON DUPLICATE KEY UPDATE templateData = VALUES(templateData)
      `, [id, fingerprintId]);
    }

    console.log(`👤 MySQL: User '${name}' (${id}) added successfully.`);
    res.status(201).json({ success: true, user: { id, name, department, designation, email, phone, fingerprintId, status, avatar, joinedDate } });
  } catch (error: any) {
    console.error("Error creating user:", error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Update a user
app.put('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  const { name, department, designation, email, phone, fingerprintId, status, avatar, joinedDate } = req.body;

  const db = getDbPool();
  if (!db) {
    // In-memory fallback
    const userIndex = usersInMemoryDb.findIndex(u => u.id === id);
    if (userIndex === -1) {
      return res.status(404).json({ error: `Employee user with ID '${id}' not found.` });
    }
    const user = usersInMemoryDb[userIndex];
    if (name !== undefined) user.name = name;
    if (department !== undefined) user.department = department;
    if (designation !== undefined) user.designation = designation;
    if (email !== undefined) user.email = email;
    if (phone !== undefined) user.phone = phone;
    if (status !== undefined) user.status = status;
    if (avatar !== undefined) user.avatar = avatar;
    if (joinedDate !== undefined) user.joinedDate = joinedDate;
    if (fingerprintId !== undefined) {
      user.fingerprintId = fingerprintId;
      if (fingerprintId) {
        // Also ensure in fingers array
        if (!user.fingers) user.fingers = [];
        const indexFp = user.fingers.find((f: any) => f.fingerName === "Right Index");
        if (indexFp) {
          indexFp.templateData = fingerprintId;
        } else {
          user.fingers.push({ fingerName: "Right Index", templateData: fingerprintId });
        }
      }
    }
    return res.json({ success: true });
  }

  try {
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

    if (fingerprintId !== undefined && fingerprintId) {
      await db.query(`
        INSERT INTO fin_fingerprints (userId, fingerName, templateData)
        VALUES (?, 'Right Index', ?)
        ON DUPLICATE KEY UPDATE templateData = VALUES(templateData)
      `, [id, fingerprintId]);
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
  const { id } = req.params;

  const db = getDbPool();
  if (!db) {
    // In-memory fallback
    const len = usersInMemoryDb.length;
    usersInMemoryDb = usersInMemoryDb.filter(u => u.id !== id);
    if (usersInMemoryDb.length === len) {
      return res.status(404).json({ error: `Employee user with ID '${id}' not found.` });
    }
    return res.json({ success: true });
  }

  try {
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

// 5. Register/Save a specific finger for a user
app.post('/api/users/:id/fingers', async (req, res) => {
  const { id } = req.params;
  const {
    fingerName = "Right Index",
    templateData,
    BMPBase64,
    ErrorCode,
    ISOTemplateBase64,
    ImageDPI,
    ImageDataBase64,
    ImageHeight,
    ImageQuality,
    ImageWidth,
    Manufacturer,
    Model,
    NFIQ,
    SerialNumber,
    TemplateBase64
  } = req.body;

  const templateVal = templateData || TemplateBase64 || ISOTemplateBase64;

  if (!templateVal) {
    return res.status(400).json({ error: "Missing biometric template data (templateData or TemplateBase64)." });
  }

  const db = getDbPool();
  if (!db) {
    // In-memory fallback
    const user = usersInMemoryDb.find(u => u.id === id);
    if (!user) {
      return res.status(404).json({ error: "Employee not found." });
    }
    if (!user.fingers) {
      user.fingers = [];
    }
    const fingerObj = {
      fingerName,
      templateData: templateVal,
      BMPBase64: BMPBase64 || null,
      ErrorCode: ErrorCode !== undefined ? ErrorCode : 0,
      ISOTemplateBase64: ISOTemplateBase64 || null,
      ImageDPI: ImageDPI || null,
      ImageDataBase64: ImageDataBase64 || null,
      ImageHeight: ImageHeight || null,
      ImageQuality: ImageQuality || null,
      ImageWidth: ImageWidth || null,
      Manufacturer: Manufacturer || null,
      Model: Model || null,
      NFIQ: NFIQ || null,
      SerialNumber: SerialNumber || null,
      TemplateBase64: TemplateBase64 || null
    };
    user.fingers = user.fingers.filter((f: any) => f.fingerName !== fingerName);
    user.fingers.push(fingerObj);
    
    // Legacy support
    user.fingerprintId = templateVal;

    return res.json({ success: true, fingers: user.fingers });
  }

  try {
    // Check if user exists
    const [userRows]: any = await db.query('SELECT * FROM fin_user WHERE id = ?', [id]);
    if (userRows.length === 0) {
      return res.status(404).json({ error: "Employee not found." });
    }

    // Upsert fingerprint template with all metadata fields
    await db.query('DELETE FROM fin_fingerprints WHERE userId = ? AND fingerName = ?', [id, fingerName]);
    await db.query(`
      INSERT INTO fin_fingerprints (
        userId, fingerName, templateData, BMPBase64, ErrorCode, ISOTemplateBase64,
        ImageDPI, ImageDataBase64, ImageHeight, ImageQuality, ImageWidth,
        Manufacturer, Model, NFIQ, SerialNumber, TemplateBase64
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      fingerName,
      templateVal,
      BMPBase64 || null,
      ErrorCode !== undefined ? ErrorCode : null,
      ISOTemplateBase64 || null,
      ImageDPI || null,
      ImageDataBase64 || null,
      ImageHeight || null,
      ImageQuality || null,
      ImageWidth || null,
      Manufacturer || null,
      Model || null,
      NFIQ || null,
      SerialNumber || null,
      TemplateBase64 || null
    ]);

    // Update the legacy column to hold the latest fingerprint template
    await db.query('UPDATE fin_user SET fingerprintId = ? WHERE id = ?', [templateVal, id]);

    console.log(`🔑 MySQL: Registered finger '${fingerName}' with full SecuGen response data for User '${id}'`);
    res.json({ success: true });
  } catch (error: any) {
    console.error("Error saving finger fingerprint:", error);
    res.status(500).json({ error: error.message });
  }
});

// 6. Delete a registered finger for a user
app.delete('/api/users/:id/fingers/:fingerName', async (req, res) => {
  const { id, fingerName } = req.params;

  const db = getDbPool();
  if (!db) {
    // In-memory fallback
    const user = usersInMemoryDb.find(u => u.id === id);
    if (user && user.fingers) {
      user.fingers = user.fingers.filter((f: any) => f.fingerName !== fingerName);
      user.fingerprintId = user.fingers.length > 0 ? user.fingers[0].templateData : null;
    }
    return res.json({ success: true });
  }

  try {
    await db.query('DELETE FROM fin_fingerprints WHERE userId = ? AND fingerName = ?', [id, fingerName]);
    
    // Sync the legacy column with the next available template (if any)
    const [fpRows]: any = await db.query('SELECT templateData FROM fin_fingerprints WHERE userId = ? ORDER BY id DESC LIMIT 1', [id]);
    const latestTemplate = fpRows.length > 0 ? fpRows[0].templateData : null;
    await db.query('UPDATE fin_user SET fingerprintId = ? WHERE id = ?', [latestTemplate, id]);

    console.log(`🗑️ MySQL: Removed finger '${fingerName}' for User '${id}'`);
    res.json({ success: true });
  } catch (error: any) {
    console.error("Error deleting finger fingerprint:", error);
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
