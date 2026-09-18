require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { supabase } = require("./db");
const { signUser, requireAuth } = require("./auth");
const queue = require("./queue");

const app = express();
const origin = process.env.FRONTEND_ORIGIN || "http://localhost:5173";

app.use(
  cors({
    origin,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "dequeue" });
});

app.get("/api/services", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("services")
      .select("*")
      .eq("active", true)
      .order("name");
    if (error) throw error;
    const withEta = await Promise.all(
      (data || []).map(async (service) => {
        const snap = await queue.getQueueSnapshot(service.id);
        return { ...service, peopleWaiting: snap.peopleWaiting, etaMinutes: snap.etaMinutes };
      })
    );
    res.json(withEta);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/services/:id", async (req, res) => {
  try {
    const snap = await queue.getQueueSnapshot(req.params.id);
    res.json(snap);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post("/api/customers/session", (req, res) => {
  const { name, phone } = req.body || {};
  if (!name || !phone) {
    return res.status(400).json({ error: "Name and phone are required" });
  }
  const token = signUser({ role: "customer", name, phone });
  res.json({ token, customer: { name, phone } });
});

app.post("/api/queue/join", async (req, res) => {
  try {
    const { serviceId, customerName, contact, source } = req.body || {};
    if (!serviceId || !customerName || !contact) {
      return res.status(400).json({ error: "Service, name and phone are required" });
    }
    const result = await queue.joinQueue({
      serviceId,
      customerName,
      contact,
      source: source || "web",
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get("/api/queue/:id", async (req, res) => {
  try {
    const payload = await queue.trackerPayload(req.params.id);
    res.json(payload);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get("/api/queue/live/:serviceId", async (req, res) => {
  try {
    const snap = await queue.getQueueSnapshot(req.params.serviceId);
    res.json(snap);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post("/api/queue/:id/rate", async (req, res) => {
  try {
    const rating = Number(req.body?.rating);
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Rating must be 1 to 5" });
    }
    const { data, error } = await supabase
      .from("queues")
      .update({ rating })
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { employeeId, password } = req.body || {};
    if (!employeeId || !password) {
      return res.status(400).json({ error: "Staff ID and password are required" });
    }
    const { data, error } = await supabase.rpc("verify_staff", {
      p_employee_id: employeeId,
      p_password: password,
    });
    if (error) throw error;
    const staff = Array.isArray(data) ? data[0] : data;
    if (!staff) return res.status(401).json({ error: "Invalid credentials" });

    const { data: counter } = await supabase
      .from("counters")
      .select("*")
      .eq("staff_id", staff.id)
      .maybeSingle();

    const token = signUser({
      id: staff.id,
      name: staff.name,
      employeeId: staff.employee_id,
      role: staff.role,
      counterId: counter?.id || null,
    });
    res.json({ token, user: { ...staff, counter } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function staffCounter(req) {
  if (req.user.counterId) return req.user.counterId;
  const { data } = await supabase
    .from("counters")
    .select("id")
    .eq("staff_id", req.user.id)
    .maybeSingle();
  return data?.id || null;
}

app.get("/api/staff/dashboard", requireAuth(["staff", "admin"]), async (req, res) => {
  try {
    const counterId = await staffCounter(req);
    const overview = await queue.overview();
    let current = null;
    let upcoming = [];
    let myCounter = null;

    if (counterId) {
      const { data: counter } = await supabase
        .from("counters")
        .select("*")
        .eq("id", counterId)
        .single();
      myCounter = counter;

      const { data: currentRows } = await supabase
        .from("queues")
        .select("*, services(*)")
        .eq("counter_id", counterId)
        .in("status", ["called", "serving"])
        .limit(1);
      current = currentRows?.[0] || null;

      const { data: links } = await supabase
        .from("counter_services")
        .select("service_id")
        .eq("counter_id", counterId);
      const serviceIds = (links || []).map((row) => row.service_id);
      if (serviceIds.length) {
        const { data: waiting } = await supabase
          .from("queues")
          .select("*, services(*)")
          .in("service_id", serviceIds)
          .eq("status", "waiting")
          .order("joined_at", { ascending: true })
          .limit(8);
        upcoming = waiting || [];
      }
    }

    res.json({
      user: req.user,
      counter: myCounter,
      current,
      upcoming,
      overview,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/staff/history", requireAuth(["staff", "admin"]), async (req, res) => {
  try {
    const counterId = await staffCounter(req);
    let query = supabase
      .from("queues")
      .select("*, services(*)")
      .in("status", ["completed", "skipped"])
      .order("completed_at", { ascending: false })
      .limit(40);
    if (counterId && req.user.role === "staff") query = query.eq("counter_id", counterId);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/staff/call-next", requireAuth(["staff", "admin"]), async (req, res) => {
  try {
    const counterId = req.body?.counterId || (await staffCounter(req));
    if (!counterId) return res.status(400).json({ error: "No counter assigned" });
    const ticket = await queue.callNext(counterId);
    res.json(ticket);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post("/api/staff/complete", requireAuth(["staff", "admin"]), async (req, res) => {
  try {
    const counterId = req.body?.counterId || (await staffCounter(req));
    const ticket = await queue.completeCurrent(counterId);
    res.json(ticket);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post("/api/staff/skip", requireAuth(["staff", "admin"]), async (req, res) => {
  try {
    const counterId = req.body?.counterId || (await staffCounter(req));
    const ticket = await queue.skipCurrent(counterId);
    res.json(ticket);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post("/api/staff/counter-status", requireAuth(["staff", "admin"]), async (req, res) => {
  try {
    const counterId = req.body?.counterId || (await staffCounter(req));
    const status = req.body?.status;
    if (!["available", "paused", "offline", "serving"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    const { data, error } = await supabase
      .from("counters")
      .update({ status })
      .eq("id", counterId)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/overview", requireAuth(["admin"]), async (_req, res) => {
  try {
    res.json(await queue.overview());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/staff", requireAuth(["admin"]), async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("staff")
      .select("id, name, employee_id, role, created_at, counters(id, name, number, status)")
      .order("name");
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/staff", requireAuth(["admin"]), async (req, res) => {
  try {
    const { name, employeeId, password, role } = req.body || {};
    if (!name || !employeeId || !password) {
      return res.status(400).json({ error: "Name, ID and password are required" });
    }
    const { data: existing } = await supabase
      .from("staff")
      .select("id")
      .eq("employee_id", employeeId)
      .maybeSingle();
    if (existing) return res.status(409).json({ error: "Staff ID already exists" });

    const { error: rpcError } = await supabase.rpc("create_staff_account", {
      p_name: name,
      p_employee_id: employeeId,
      p_password: password,
      p_role: role === "admin" ? "admin" : "staff",
    });
    if (rpcError) throw rpcError;
    const { data } = await supabase
      .from("staff")
      .select("id, name, employee_id, role, created_at")
      .eq("employee_id", employeeId)
      .single();
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/counters", requireAuth(["admin"]), async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("counters")
      .select("*, staff(id, name, employee_id), counter_services(service_id, services(name, prefix))")
      .order("number");
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/counters", requireAuth(["admin"]), async (req, res) => {
  try {
    const { name, number, staffId, serviceIds } = req.body || {};
    const { data, error } = await supabase
      .from("counters")
      .insert({
        name: name || `Counter ${number}`,
        number,
        status: "offline",
        staff_id: staffId || null,
      })
      .select()
      .single();
    if (error) throw error;
    if (serviceIds?.length) {
      await supabase.from("counter_services").insert(
        serviceIds.map((service_id) => ({ counter_id: data.id, service_id }))
      );
    }
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/admin/counters/:id", requireAuth(["admin"]), async (req, res) => {
  try {
    const { status, staffId, serviceIds, active } = req.body || {};
    const patch = {};
    if (status) patch.status = active === false ? "offline" : status;
    if (active === false) patch.status = "offline";
    if (active === true && !status) patch.status = "available";
    if (staffId !== undefined) patch.staff_id = staffId;
    if (Object.keys(patch).length) {
      const { error } = await supabase.from("counters").update(patch).eq("id", req.params.id);
      if (error) throw error;
    }
    if (Array.isArray(serviceIds)) {
      await supabase.from("counter_services").delete().eq("counter_id", req.params.id);
      if (serviceIds.length) {
        await supabase.from("counter_services").insert(
          serviceIds.map((service_id) => ({ counter_id: req.params.id, service_id }))
        );
      }
    }
    const { data } = await supabase.from("counters").select("*").eq("id", req.params.id).single();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/services", requireAuth(["admin"]), async (req, res) => {
  try {
    const { name, description, prefix, average_service_time } = req.body || {};
    const { data, error } = await supabase
      .from("services")
      .insert({
        name,
        description,
        prefix: (prefix || "X").slice(0, 2).toUpperCase(),
        average_service_time: Number(average_service_time) || 5,
        active: true,
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/admin/services/:id", requireAuth(["admin"]), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("services")
      .update(req.body)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/analytics", requireAuth(["admin"]), async (_req, res) => {
  try {
    const overview = await queue.overview();
    const { data: queues } = await supabase.from("queues").select("*, services(name, average_service_time)");
    const bySource = {};
    for (const row of queues || []) {
      const key = row.source || "web";
      bySource[key] = (bySource[key] || 0) + 1;
    }
    res.json({ ...overview, bySource, tokens: queues || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/kiosks", requireAuth(["admin"]), async (_req, res) => {
  try {
    const { data, error } = await supabase.from("kiosks").select("*").order("name");
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/alerts", requireAuth(["admin"]), async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("alerts")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/admin/alerts/:id", requireAuth(["admin"]), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("alerts")
      .update({ is_read: true })
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use((err, _req, res, _next) => {
  res.status(500).json({ error: err.message || "Server error" });
});

const port = Number(process.env.PORT) || 5000;
app.listen(port, () => {
  console.log(`DeQueue API on http://localhost:${port}`);
});
