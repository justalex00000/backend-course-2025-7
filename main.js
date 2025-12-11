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

const program = new Command();

program
  .option("-h, --host <host>", "Hostname", process.env.HOST )
  .option("-p, --port <port>", "Port number", process.env.PORT )
  .option("-c, --cache <dir>", "Cache directory path", './cache');

program.parse(process.argv);
const { host, port, cache } = program.opts();

const CACHE_DIR = path.resolve(cache);
const UPLOADS_DIR = path.join(CACHE_DIR, "uploads");
const DB_FILE = path.join(CACHE_DIR, "db.json");

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ items: [] }, null, 2));
}

function loadDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function genId() {
  return `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.use("/", express.static("./public"));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) =>
    cb(
      null,
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.originalname}`
    ),
});

const upload = multer({ storage });

app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpecs));


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
app.post("/register", upload.single("photo"), (req, res) => {
  const { inventory_name, description } = req.body;

  if (!inventory_name || inventory_name.trim() === "") {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "inventory_name is required" });
  }

  const db = loadDB();
  const id = genId();

  const item = {
    id,
    name: inventory_name,
    description: description || "",
    photo: req.file ? path.basename(req.file.path) : null,
    createdAt: new Date().toISOString(),
  };

  db.items.push(item);
  saveDB(db);

  return res.status(201).json(item);
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
app.get("/inventory", (req, res) => {
  const db = loadDB();

  const enriched = db.items.map((it) => ({
    ...it,
    photo_url: it.photo
      ? `${req.protocol}://${req.get("host")}/inventory/${it.id}/photo`
      : null,
  }));

  res.status(200).json(enriched);
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
app.get("/inventory/:id", (req, res) => {
  const db = loadDB();
  const it = db.items.find((x) => x.id === req.params.id);

  if (!it) return res.status(404).json({ error: "Not found" });

  return res.status(200).json({
    ...it,
    photo_url: it.photo
      ? `${req.protocol}://${req.get("host")}/inventory/${it.id}/photo`
      : null,
  });
});


app.put("/inventory/:id", (req, res) => {
  const db = loadDB();
  const idx = db.items.findIndex((x) => x.id === req.params.id);

  if (idx === -1) return res.status(404).json({ error: "Not found" });

  const { name, description } = req.body;

  if (name !== undefined) db.items[idx].name = name;
  if (description !== undefined) db.items[idx].description = description;

  db.items[idx].updatedAt = new Date().toISOString();
  saveDB(db);

  return res.status(200).json(db.items[idx]);
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
app.get("/inventory/:id/photo", (req, res) => {
  const db = loadDB();
  const it = db.items.find((x) => x.id === req.params.id);

  if (!it || !it.photo) return res.status(404).send("Photo not found");

  const fpath = path.join(UPLOADS_DIR, it.photo);

  if (!fs.existsSync(fpath)) return res.status(404).send("Photo not found");

  res.setHeader("Content-Type", "image/jpeg");
  fs.createReadStream(fpath).pipe(res);
});


app.put("/inventory/:id/photo", upload.single("photo"), (req, res) => {
  const db = loadDB();
  const idx = db.items.findIndex((x) => x.id === req.params.id);

  if (idx === -1) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: "Not found" });
  }

  if (!req.file)
    return res.status(400).json({ error: "photo file is required" });

  const oldPhoto = db.items[idx].photo;
  if (oldPhoto && fs.existsSync(path.join(UPLOADS_DIR, oldPhoto))) {
    fs.unlinkSync(path.join(UPLOADS_DIR, oldPhoto));
  }

  db.items[idx].photo = req.file.filename;
  db.items[idx].updatedAt = new Date().toISOString();
  saveDB(db);

  return res.status(200).json(db.items[idx]);
});


app.delete("/inventory/:id", (req, res) => {
  const db = loadDB();
  const idx = db.items.findIndex((x) => x.id === req.params.id);

  if (idx === -1) return res.status(404).json({ error: "Not found" });

  const photo = db.items[idx].photo;
  if (photo) {
    const p = path.join(UPLOADS_DIR, photo);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  const deleted = db.items.splice(idx, 1)[0];
  saveDB(db);

  return res.status(200).json({ deleted: deleted.id });
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
app.get("/search", (req, res) => {
  const { id, includePhoto } = req.query;

  if (!id) return res.status(400).json({ error: "id is required" });

  const db = loadDB();
  const it = db.items.find((x) => x.id === id);

  if (!it) return res.status(404).json({ error: "Not found" });

  return res.status(200).json({
    ...it,
    photo_url:
      includePhoto && it.photo
        ? `${req.protocol}://${req.get("host")}/inventory/${it.id}/photo`
        : null,
  });
});


app.post("/search", (req, res) => {
  const { id, includePhoto } = req.body;

  if (!id) return res.status(400).json({ error: "id is required" });

  const db = loadDB();
  const it = db.items.find((x) => x.id === id);

  if (!it) return res.status(404).json({ error: "Not found" });

  return res.status(200).json({
    ...it,
    photo_url:
      includePhoto && it.photo
        ? `${req.protocol}://${req.get("host")}/inventory/${it.id}/photo`
        : null,
  });
});

//405
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

const server = http.createServer(app);

server.listen(port, host, () => {
  console.log(`Server running at http://${host}:${port}`);
});
