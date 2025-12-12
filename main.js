import { Command } from "commander";
import http from "http";
import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import bodyParser from "body-parser";
import swaggerUi from "swagger-ui-express";
import swaggerJsdoc from "swagger-jsdoc";
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

// --- PostgreSQL Pool ---
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 5432,
  user: process.env.DB_USER || 'user',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'mydb',
});

// --- Swagger ---
const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Inventory API",
      version: "1.0.0",
      description: "API documentation for Inventory Web Service",
    },
  },
  apis: ["./main.js"],
};
const swaggerSpecs = swaggerJsdoc(swaggerOptions);

// --- Commander ---
const program = new Command();
program
  .option("-h, --host <host>", "Hostname", process.env.HOST )
  .option("-p, --port <port>", "Port number", process.env.PORT )
  .option("-c, --cache <dir>", "Cache directory path", './cache');

program.parse(process.argv);
const { host, port, cache } = program.opts();

// --- Uploads directories ---
const CACHE_DIR = path.resolve(cache);
const UPLOADS_DIR = path.join(CACHE_DIR, "uploads");
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// --- Express ---
const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use("/", express.static("./public"));
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpecs));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) =>
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.originalname}`)
});
const upload = multer({ storage });

// --- DB Functions ---
async function addItem(item) {
  const result = await pool.query(
    `INSERT INTO items (name, description, photo, created_at)
     VALUES ($1, $2, $3, NOW()) RETURNING *`,
    [item.name, item.description, item.photo]
  );
  return result.rows[0];
}

async function getItems() {
  const result = await pool.query(`SELECT * FROM items ORDER BY created_at DESC`);
  return result.rows;
}

async function getItemById(id) {
  const result = await pool.query(`SELECT * FROM items WHERE id=$1`, [id]);
  return result.rows[0];
}

async function updateItem(id, data) {
  const fields = [];
  const values = [];
  let idx = 1;

  if (data.name) { fields.push(`name=$${idx++}`); values.push(data.name); }
  if (data.description) { fields.push(`description=$${idx++}`); values.push(data.description); }
  if (data.photo) { fields.push(`photo=$${idx++}`); values.push(data.photo); }
  if (fields.length === 0) return null;

  values.push(id);
  const result = await pool.query(
    `UPDATE items SET ${fields.join(', ')}, updated_at=NOW() WHERE id=$${idx} RETURNING *`,
    values
  );
  return result.rows[0];
}

async function deleteItem(id) {
  const result = await pool.query(`DELETE FROM items WHERE id=$1 RETURNING *`, [id]);
  return result.rows[0];
}

app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpecs));

// --- Routes ---

/**
 * @openapi
 * /register:
 *   post:
 *     summary: Register a new inventory item
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - inventory_name
 *             properties:
 *               inventory_name:
 *                 type: string
 *                 description: Name of the item
 *               description:
 *                 type: string
 *                 description: Description of the item
 *               photo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Item successfully created
 *       400:
 *         description: Missing inventory_name
 */

app.post("/register", upload.single("photo"), async (req, res) => {
  try {
    const { inventory_name, description } = req.body;
    if (!inventory_name || inventory_name.trim() === "") {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "inventory_name is required" });
    }

    const item = {
      name: inventory_name,
      description: description || "",
      photo: req.file ? path.basename(req.file.path) : null,
    };
    const saved = await addItem(item);
    res.status(201).json(saved);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * @openapi
 * /inventory:
 *   get:
 *     summary: Get all inventory items
 *     responses:
 *       200:
 *         description: Returns list of all items
 */

app.get("/inventory", async (req, res) => {
  try {
    const items = await getItems();
    const enriched = items.map(it => ({
      ...it,
      photo_url: it.photo ? `${req.protocol}://${req.get("host")}/inventory/${it.id}/photo` : null
    }));
    res.status(200).json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * @openapi
 * /inventory/{id}:
 *   get:
 *     summary: Get item by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the item
 *     responses:
 *       200:
 *         description: Item found
 *       404:
 *         description: Item not found
 *   put:
 *     summary: Update an item (name/description)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the item to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: New name of the item
 *               description:
 *                 type: string
 *                 description: New description of the item
 *     responses:
 *       200:
 *         description: Item updated
 *       404:
 *         description: Item not found
 *   delete:
 *     summary: Delete an inventory item
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the item to delete
 *     responses:
 *       200:
 *         description: Item successfully deleted
 *       404:
 *         description: Item not found
 */

/**
 * @openapi
 * /RegisterForm.html:
 *   get:
 *     summary: Web form to register a new inventory device
 *     responses:
 *       200:
 *         description: HTML form for device registration
 */
/**
 * @openapi
 * /SearchForm.html:
 *   get:
 *     summary: Web form to search for an inventory device
 *     responses:
 *       200:
 *         description: HTML form for device search
 */

app.get("/inventory/:id", async (req, res) => {
  try {
    const it = await getItemById(req.params.id);
    if (!it) return res.status(404).json({ error: "Not found" });

    res.status(200).json({
      ...it,
      photo_url: it.photo ? `${req.protocol}://${req.get("host")}/inventory/${it.id}/photo` : null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.put("/inventory/:id", async (req, res) => {
  try {
    const updated = await updateItem(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: "Not found or nothing to update" });
    res.status(200).json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/inventory/:id", async (req, res) => {
  try {
    const it = await getItemById(req.params.id);
    if (!it) return res.status(404).json({ error: "Not found" });

    if (it.photo) {
      const fpath = path.join(UPLOADS_DIR, it.photo);
      if (fs.existsSync(fpath)) fs.unlinkSync(fpath);
    }

    const deleted = await deleteItem(req.params.id);
    res.status(200).json({ deleted: deleted.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * @openapi
 * /inventory/{id}/photo:
 *   get:
 *     summary: Get item photo
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the item
 *     responses:
 *       200:
 *         description: JPEG photo file
 *       404:
 *         description: Photo or item not found
 *   put:
 *     summary: Update item photo
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the item
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               photo:
 *                 type: string
 *                 format: binary
 *                 description: New photo file
 *     responses:
 *       200:
 *         description: Photo updated
 *       400:
 *         description: Photo file missing
 *       404:
 *         description: Item not found
 */

app.get("/inventory/:id/photo", async (req, res) => {
  try {
    const it = await getItemById(req.params.id);
    if (!it || !it.photo) return res.status(404).send("Photo not found");

    const fpath = path.join(UPLOADS_DIR, it.photo);
    if (!fs.existsSync(fpath)) return res.status(404).send("Photo not found");

    res.setHeader("Content-Type", "image/jpeg");
    fs.createReadStream(fpath).pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).send("Internal server error");
  }
});

app.put("/inventory/:id/photo", upload.single("photo"), async (req, res) => {
  try {
    const it = await getItemById(req.params.id);
    if (!it) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: "Not found" });
    }

    if (!req.file) return res.status(400).json({ error: "photo file is required" });

    if (it.photo) {
      const oldPath = path.join(UPLOADS_DIR, it.photo);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const updated = await updateItem(req.params.id, { photo: req.file.filename });
    res.status(200).json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * @openapi
 * /search:
 *   get:
 *     summary: Search an inventory item by ID
 *     parameters:
 *       - in: query
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the item to search
 *       - in: query
 *         name: includePhoto
 *         required: false
 *         schema:
 *           type: string
 *           enum: ["on"]
 *         description: |
 *           Include URL to the item's photo.
 *           If checkbox not checked, parameter is undefined.
 *           If checkbox checked, parameter value is "on".
 *     responses:
 *       200:
 *         description: Found item
 *       400:
 *         description: Missing id parameter
 *       404:
 *         description: Item not found
 *   post:
 *     summary: Search an inventory item by ID (POST)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *               includePhoto:
 *                 type: string
 *     responses:
 *       200: 
 *         description: Found item
 *       400:
 *         description: Missing id in request body
 *       404:
 *         description: Item not found
 */

app.get("/search", async (req, res) => {
  try {
    const { id, includePhoto } = req.query;
    if (!id) return res.status(400).json({ error: "id is required" });

    const it = await getItemById(id);
    if (!it) return res.status(404).json({ error: "Not found" });

    res.status(200).json({
      ...it,
      photo_url: includePhoto && it.photo
        ? `${req.protocol}://${req.get("host")}/inventory/${it.id}/photo`
        : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/search", async (req, res) => {
  try {
    const { id, includePhoto } = req.body;
    if (!id) return res.status(400).json({ error: "id is required" });

    const it = await getItemById(id);
    if (!it) return res.status(404).json({ error: "Not found" });

    res.status(200).json({
      ...it,
      photo_url: includePhoto && it.photo
        ? `${req.protocol}://${req.get("host")}/inventory/${it.id}/photo`
        : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});


// --- 405 handler ---
function allow(allowed) {
  return (req, res) => {
    if (!allowed.includes(req.method)) {
      res.setHeader("Allow", allowed.join(", "));
      return res.status(405).json({ error: "Method Not Allowed" });
    }
    res.status(404).end();
  };
}

app.all("/register", allow(["POST"]));
app.all("/inventory", allow(["GET"]));
app.all("/inventory/:id", allow(["GET", "PUT", "DELETE"]));
app.all("/inventory/:id/photo", allow(["GET", "PUT"]));
app.all("/search", allow(["GET", "POST"]));

// --- Start server ---
const server = http.createServer(app);
server.listen(port, host, () => {
  console.log(`Server running at http://${host}:${port}`);
});
