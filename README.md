# 🍽️ MealSync — Smart Hostel Mess Queue & Dining Management System

[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-v5.2-blue.svg)](https://expressjs.com/)
[![MongoDB Atlas](https://img.shields.io/badge/MongoDB-Atlas_Cloud-brightgreen.svg)](https://www.mongodb.com/atlas)
[![CORS Enabled](https://img.shields.io/badge/CORS-Configured-orange.svg)](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
[![Frontend](https://img.shields.io/badge/Frontend-Vercel-black.svg)](https://vercel.com/)
[![Backend](https://img.shields.io/badge/Backend-Render-46E3B7.svg)](https://render.com/)

**MealSync** is a full-stack, smart mess management platform designed to eliminate long queues, food wastage, and chaotic rush hours in college hostel dining halls. Featuring separate, independently deployable tiers connected via **Cross-Origin Resource Sharing (CORS)**, MealSync allows students to check live counter lines, join queues remotely from their dorms, and receive real-time audio and browser push notifications when their meal is ready.

---

## 📑 Table of Contents

1. [Architecture Overview](#-architecture-overview)
2. [How It Works & Feature Highlights](#-how-it-works--feature-highlights)
3. [Project Directory Structure](#-project-directory-structure)
4. [Cross-Origin Resource Sharing (CORS) Setup](#-cross-origin-resource-sharing-cors-setup)
5. [Database Connection & Resilience](#-database-connection--resilience)
6. [Complete Backend API Reference](#-complete-backend-api-reference)
7. [Deployment Guide: Render (Backend)](#-deployment-guide-render-backend)
8. [Deployment Guide: Vercel (Frontend)](#-deployment-guide-vercel-frontend)
9. [Local Development Guide](#-local-development-guide)
10. [Environment Variables Reference](#-environment-variables-reference)

---

## 🏗️ Architecture Overview

The system is split into two independent services:
- **Frontend (Client)**: Ultra-fast, lightweight static web application hosted on **Vercel**.
- **Backend (API Server)**: High-performance Node.js / Express server hosted on **Render**, backed by **MongoDB Atlas** with resilient local JSON fallback.

```mermaid
flowchart LR
    subgraph Client ["Client Tier (Vercel)"]
        UI["Student / Staff / Admin Portal\n(HTML5 / Vanilla CSS / ES6)"]
        SW["Service Worker (sw.js)\nPush & Audio Chimes"]
        CFG["config.js\n(Dynamic API URL Routing)"]
    end

    subgraph Hosting ["Cross-Origin Communication (CORS)"]
        HTTP["REST API Requests\n(GET / POST / DELETE)"]
        SSE["Server-Sent Events (SSE)\n(Real-Time /api/stream)"]
    end

    subgraph Backend ["Server Tier (Render)"]
        API["Express Server (server.js)\nCORS Middleware & Auth"]
        ENGINE["Queue & Wait-Time Engine\n(Dynamic Sliding Window Pace)"]
    end

    subgraph Database ["Data Tier"]
        ATLAS[("MongoDB Atlas Cloud\n(Counters, Serves, Schedules)")]
        FALLBACK[("Local JSON Store\n(mealsync_store.json)")]
    end

    UI --> CFG
    CFG --> HTTP & SSE
    HTTP & SSE --> API
    API --> ENGINE
    ENGINE --> ATLAS
    ATLAS -. Failover Fallback .-> FALLBACK
```

---

## 🚀 How It Works & Feature Highlights

### 1. 🎓 Student Portal
- **Zero-Wait Remote Queueing**: Students view all dining counters with live menus, diet badges (Veg / Non-Veg), and real-time line lengths.
- **Smart Queue Wait Estimation**: Dynamic calculation of wait times based on historical serving durations:
  $$\text{Estimated Wait} = (\text{Queue Position} - 1) \times \text{Avg Serve Pace}$$
- **Single-Line Policy**: Automatically removes a student from their previous line if they switch counters.
- **Audio & Push Alerts**: Plays a chime via the Web Audio API and triggers browser push notifications when a student reaches the front of the line.

### 2. 👨‍🍳 Staff / Chef Portal
- **Fast Token Processing**: 1-click token dispatch (`Serve Next Student`) that pops the student from the line, calculates exact seconds spent, and logs the transaction.
- **Self-Adjusting Pace Algorithm**: A moving window of the last 8 serves automatically recalculates the counter's `avgServeSeconds`.
- **Line Control**: Staff can close a line for restock or emergency with real-time broadcast.

### 3. 🛡️ Admin Portal
- **Live Mess Metrics**: Real-time stats on active counters, total students queued, total served today, and global serving pace.
- **Meal Schedule Engine**: Create and manage scheduled dining slots (Breakfast, Lunch, Evening Snacks, Dinner) with start/end times and daily active toggles.
- **Queue Moderation**: Kick unruly tokens or clear queues instantly.
- **Audit Logging & CSV Export**: Complete historical log of every meal served, downloadable as a formatted CSV spreadsheet with 1 click.
- **Broadcast Announcements**: Instantly broadcast administrative alerts (e.g. menu changes, feast night notices) to all connected devices.

### 4. ⚡ Real-Time SSE Synchronization
- Built on **Server-Sent Events** (`/api/stream`).
- When a counter is updated, a student joins, or a meal is served, the server broadcasts an event (`queue_updated`, `counters_updated`, `student_served`, `settings_updated`).
- All active browser screens refresh their queues immediately without polling or manual page reloads.

---

## 📂 Project Directory Structure

```
AWS-hackathon/
├── frontend/                     # Static Web App (Deploy to VERCEL)
│   ├── index.html                # Main UI layout (Preserved look & feel)
│   ├── index.css                 # Sleek dark-mode aesthetic & animations
│   ├── app.js                    # Client logic with CORS routing wrapper
│   ├── config.js                 # API target config & runtime URL switcher
│   ├── logo.svg                  # Brand SVG emblem
│   ├── sw.js                     # Service worker for Web Push notifications
│   └── vercel.json               # Vercel deployment headers and cache rules
│
├── backend/                      # Node.js & Express API (Deploy to RENDER)
│   ├── server.js                 # Express server, CORS setup & MongoDB logic
│   ├── package.json              # Backend dependencies (express, cors, mongodb, dotenv)
│   ├── package-lock.json         # Pinned dependency versions
│   ├── .env                      # Local environment configuration
│   ├── .env.example              # Environment variable template for deployment
│   ├── render.yaml               # Render blueprint file (1-click deploy)
│   └── data/
│       └── mealsync_store.json   # High-reliability local fallback database
│
├── .gitignore                    # Protects .env secrets & node_modules
└── README.md                     # Comprehensive project documentation
```

---

## 🌐 Cross-Origin Resource Sharing (CORS) Setup

Because the frontend is hosted on **Vercel** (`https://aws-hackathon-six.vercel.app`) and the backend is on **Render** (`https://aws-hackathon-1.onrender.com`), the browser enforces the Same-Origin Policy.

### Backend CORS Configuration (`backend/server.js`)
The backend uses the `cors` middleware with custom origin matching:
```javascript
const cors = require('cors');

const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()) 
  : ['*'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return callback(null, true);
    if (/^https?:\/\/.*\.vercel\.app$/.test(origin)) return callback(null, true); // Automatic Vercel preview support
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  credentials: true
}));
```

### Frontend Automatic API Routing (`frontend/config.js` & `frontend/app.js`)
All calls to `/api/...` in the frontend are automatically prefixed with the configured backend URL:
- When running locally, it connects to `http://localhost:3000`.
- When deployed on Vercel, it connects to your Render backend URL.
- **Runtime Switcher**: You can inspect or change the API target at any time by clicking the green **"System Connected"** pill in the navigation bar!

---

## 🗄️ Database Connection & Resilience

MealSync uses a **Dual-Layer Storage Architecture**:
1. **Primary**: **MongoDB Atlas** (Cloud Database) for distributed persistence.
2. **Fail-Safe Fallback**: **Local JSON File Store** (`backend/data/mealsync_store.json`). If MongoDB Atlas is temporarily unreachable, the backend seamlessly falls back to disk storage without crashing or dropping user operations.

### ⚠️ Critical Render + MongoDB Atlas Gotcha: IP Whitelist
By default, MongoDB Atlas blocks connections from unfamiliar IP addresses. Because Render uses dynamic outbound IPs, **you MUST allow access from anywhere in MongoDB Atlas**:
1. Go to [MongoDB Atlas](https://cloud.mongodb.com/).
2. In the left navigation, click **Security** ➔ **Network Access**.
3. Click **Add IP Address**.
4. Select **Allow Access from Anywhere** (`0.0.0.0/0`).
5. Click **Confirm**.

---

## 📡 Complete Backend API Reference

Every single endpoint hosted on the Render backend is documented below:

### 1. System & Health Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | API welcome, active service status, database health, and active counter metrics. |
| `GET` | `/api/health` | Dedicated health check endpoint for Render monitor (`200 OK`). |
| `GET` | `/api/stream` | Server-Sent Events (SSE) persistent stream for live push notifications. |
| `GET` | `/api/settings` | Retrieve global mess configuration and active announcement text. |

#### `GET /api/health`
- **Response `200 OK`**:
```json
{
  "status": "healthy",
  "uptime": 124,
  "timestamp": "2026-09-20T03:25:00.000Z",
  "database": {
    "connected": true,
    "provider": "MongoDB Atlas",
    "lastConnected": "2026-09-20T03:24:25.078Z",
    "error": null
  },
  "activeSseClients": 2,
  "countersTotal": 3,
  "servesLogged": 142
}
```

---

### 2. Authentication Endpoints

| Method | Endpoint | Request Body | Description |
|---|---|---|---|
| `POST` | `/api/auth/student-login` | `{ "studentName": "Rahul", "studentId": "2102090012" }` | Validates student name and 10-digit registration number. |
| `POST` | `/api/auth/staff-login` | `{ "staffName": "Chef Ramesh", "staffRollNo": "50101" }` | Validates staff name and 5-digit employee/roll code. |
| `POST` | `/api/auth/admin-login` | `{ "adminName": "Hostel Warden", "adminCode": "99999" }` | Validates administrator name and 5-digit security code. |

---

### 3. Counter & Queue Operations

| Method | Endpoint | Request Body / Params | Description |
|---|---|---|---|
| `GET` | `/api/counters` | _None_ | Lists all active counters, current queue positions, elapsed wait times, and current meal slot. |
| `POST` | `/api/counters` | `{ "name": "Counter 1", "foodType": "veg", "menu": ["Roti","Paneer"], "staffName": "Chef", "staffRollNo": "50101", "maxQueueSize": 20 }` | Creates a new mess dining line counter. |
| `POST` | `/api/counters/:id/join` | `{ "studentId": "2102090012", "studentName": "Rahul" }` | Student enters queue at counter `:id`. |
| `POST` | `/api/counters/:id/leave` | `{ "studentId": "2102090012" }` | Student cancels and leaves line at counter `:id`. |
| `POST` | `/api/counters/:id/serve-next` | _None_ | Staff serves the next student in queue, records serve duration, and updates pace. |
| `POST` | `/api/counters/:id/close` | _None_ | Closes counter `:id` and notifies clients via SSE. |
| `GET` | `/api/student-status` | Query: `?studentId=2102090012` | Returns the student's active queue position and estimated wait time. |

---

### 4. Queue Scheduling Endpoints

| Method | Endpoint | Request Body | Description |
|---|---|---|---|
| `GET` | `/api/schedules` | _None_ | Lists all configured meal periods (Breakfast, Lunch, Snacks, Dinner) and active session. |
| `POST` | `/api/admin/schedules` | `{ "mealName": "Dinner", "startTime": "19:30", "endTime": "21:45", "days": "Daily" }` | Adds a new scheduled dining slot. |
| `POST` | `/api/admin/schedules/:id/toggle` | _None_ | Toggles a schedule on or off. |
| `DELETE` | `/api/admin/schedules/:id` | _None_ | Deletes a schedule entry. |

---

### 5. Admin Management & Audit Endpoints

| Method | Endpoint | Request Body / Params | Description |
|---|---|---|---|
| `GET` | `/api/admin/overview` | _None_ | Complete dashboard stats, queue depths, serves today, and recent activity. |
| `POST` | `/api/admin/settings` | `{ "defaultMaxQueueSize": 25, "announcement": "New notice" }` | Updates global mess announcement and default line limits. |
| `POST` | `/api/admin/counters/:id/settings`| `{ "maxQueueSize": 30, "name": "New Name", "menu": [...] }` | Edits configuration of counter `:id`. |
| `POST` | `/api/admin/counters/:id/reopen` | _None_ | Reopens a closed counter. |
| `DELETE` | `/api/admin/counters/:id` | _None_ | Deletes a counter permanently. |
| `POST` | `/api/admin/counters/:id/kick` | `{ "studentId": "2102090012" }` | Removes a specific student from the queue. |
| `POST` | `/api/admin/counters/:id/clear` | _None_ | Clears all students from counter `:id` line. |
| `GET` | `/api/admin/serves` | Query: `?counterId=&foodType=&query=&limit=100` | Paginated and searchable audit log of served meals. |
| `GET` | `/api/admin/export-serves.csv` | _None_ | Downloads CSV file containing all served meals with timestamps, staff, and wait times. |

---

## 🚀 Deployment Guide: Render (Backend)

Follow these steps to deploy the backend API to [Render](https://render.com/):

1. **Push your repository** to GitHub.
2. Sign in to **Render Dashboard** and click **New +** ➔ **Web Service**.
3. Select your GitHub repository.
4. Configure the Web Service settings:
   - **Name**: `mealsync-backend` (or your preferred name)
   - **Region**: Choose the region closest to you (e.g., Singapore, Frankfurt, Oregon)
   - **Root Directory**: `backend` *(Crucial!)*
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: `Free`
5. Click **Advanced** and configure **Health Check Path**:
   - **Health Check Path**: `/api/health`
6. Add the following **Environment Variables**:
   - `PORT`: `10000`
   - `HOST`: `0.0.0.0`
   - `ALLOWED_ORIGINS`: `https://aws-hackathon-six.vercel.app,*`
   - `MONGODB_URI`: Your MongoDB Atlas connection URI:
     ```
     mongodb+srv://<username>:<password>@aws-hackathon.ovrbmec.mongodb.net/?appName=AWS-hackathon
     ```
7. Click **Create Web Service**.
8. Once deployed, your Render service will be live at: `https://aws-hackathon-1.onrender.com`.

---

## ⚡ Deployment Guide: Vercel (Frontend)

Follow these steps to deploy the frontend application to [Vercel](https://vercel.com/):

1. The production backend URL is already pre-configured in `frontend/config.js`:
   ```javascript
   const DEFAULT_PROD_API_URL = 'https://aws-hackathon-1.onrender.com';
   ```
2. Sign in to **Vercel** and click **Add New...** ➔ **Project**.
3. Import your GitHub repository.
4. In the **Configure Project** screen:
   - **Project Name**: `mealsync`
   - **Framework Preset**: `Other`
   - **Root Directory**: Click **Edit** and choose `frontend` *(Crucial!)*
   - **Build & Output Settings**: Leave as default (no build step needed).
5. Click **Deploy**.
6. Vercel will deploy your static site in under 30 seconds!
7. Open your Vercel URL (`https://aws-hackathon-six.vercel.app`). Notice the green **"System Connected"** pill indicating seamless cross-origin connection to Render (`https://aws-hackathon-1.onrender.com`)!

---

## 💻 Local Development Guide

You can run both frontend and backend on your local machine simultaneously:

### Prerequisites
- Node.js (v18 or higher)
- npm

### Step 1: Clone Repository
```bash
git clone https://github.com/amrutkumarmeher/AWS-hackathon.git
cd AWS-hackathon
```

### Step 2: Configure Backend Environment
Create `backend/.env`:
```env
PORT=3000
HOST=0.0.0.0
ALLOWED_ORIGINS=*
MONGODB_URI=mongodb+srv://Amrut:Amrut123456@aws-hackathon.ovrbmec.mongodb.net/?appName=AWS-hackathon
```

### Step 3: Install & Start Backend
In a terminal:
```bash
cd backend
npm install
npm start
# Backend API will run on http://localhost:3000
```

### Step 4: Start Frontend
In a separate terminal:
```bash
cd frontend
npm start
# Frontend will serve on http://localhost:5000 (or via VS Code Live Server)
```

Open `http://localhost:5000` in your web browser. The frontend on port 5000 connects to the backend on port 3000 via CORS seamlessly!

---

## 🔑 Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | Optional | `3000` (Local) / `10000` (Render) | Port for the Express server to listen on. |
| `HOST` | Optional | `0.0.0.0` | Host interface address. |
| `ALLOWED_ORIGINS` | Optional | `*` | Comma-separated list of allowed origins for CORS (e.g. `https://mealsync.vercel.app,http://localhost:5000`). |
| `MONGODB_URI` | Recommended | _None_ | MongoDB Atlas connection URI string. If omitted, backend runs in local file fallback mode. |

---

## 👨‍💻 Author & Acknowledgements

- **Developed By**: Amrut Kumar Meher
- **Project**: AWS Hackathon Hostel Mess Management Initiative
- **License**: ISC
