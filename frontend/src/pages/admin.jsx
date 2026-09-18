import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, session } from "../api";

export function AdminLogin() {
  const [employeeId, setEmployeeId] = useState("ADMIN");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function submit(e) {
    e.preventDefault();
    try {
      const data = await api("/auth/login", {
        method: "POST",
        body: { employeeId, password },
      });
      if (data.user.role !== "admin") {
        setError("This account is not an admin");
        return;
      }
      localStorage.setItem("adminToken", data.token);
      session.save("adminUser", data.user);
      navigate("/admin");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="mx-auto max-w-md px-6 py-16">
      <h1 className="font-display text-4xl">Admin login</h1>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <input
          className="w-full rounded-2xl border border-ink/10 bg-white px-4 py-3"
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
        />
        <input
          type="password"
          className="w-full rounded-2xl border border-ink/10 bg-white px-4 py-3"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-ticket">{error}</p>}
        <button className="w-full rounded-full bg-teal py-3 text-paper">Open admin panel</button>
      </form>
      <p className="mt-6 text-sm text-ink/50">Demo: ADMIN / admin123</p>
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-3xl bg-white p-5">
      <p className="text-xs uppercase tracking-[0.2em] text-ink/40">{label}</p>
      <p className="mt-3 font-display text-4xl">{value}</p>
    </div>
  );
}

export function AdminDashboard() {
  const [data, setData] = useState(null);
  useEffect(() => {
    const load = () => api("/admin/overview", { auth: "adminToken" }).then(setData);
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  if (!data) return <p>Loading…</p>;
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return (
    <div>
      <p className="text-sm text-teal">SYSTEM ONLINE</p>
      <h1 className="font-display text-4xl">{hello}, Admin</h1>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Waiting" value={data.waiting} />
        <Stat label="Counters" value={data.countersOnline} />
        <Stat label="Avg wait" value={`${data.avgWait} min`} />
        <Stat label="Served today" value={data.servedToday} />
      </div>
      <h2 className="mt-10 font-display text-2xl">Live queue status</h2>
      <div className="mt-4 overflow-hidden rounded-3xl bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-ink/5">
            <tr>
              <th className="px-4 py-3">Service</th>
              <th>Waiting</th>
              <th>Avg wait</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.serviceStats.map((s) => (
              <tr key={s.id} className="border-t border-ink/5">
                <td className="px-4 py-3">{s.name}</td>
                <td>{s.waiting}</td>
                <td>{s.avgWait} min</td>
                <td className="uppercase">{s.health}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 className="mt-10 font-display text-2xl">Counter status</h2>
      <ul className="mt-4 grid gap-2 md:grid-cols-2">
        {data.counters.map((c) => {
          const current = data.currentlyServing.find((q) => q.counter_id === c.id);
          return (
            <li key={c.id} className="rounded-2xl bg-white px-4 py-3 text-sm">
              {c.name} · {c.status.toUpperCase()} {current ? `· ${current.token_label}` : ""}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function AdminQueues() {
  const [data, setData] = useState(null);
  useEffect(() => {
    api("/admin/overview", { auth: "adminToken" }).then(setData);
  }, []);
  const waiting = (data?.queues || []).filter((q) => q.status === "waiting");
  return (
    <div>
      <h1 className="font-display text-4xl">All active queues</h1>
      <ul className="mt-6 space-y-2">
        {waiting.map((q) => (
          <li key={q.id} className="flex justify-between rounded-2xl bg-white px-4 py-3">
            <span>
              {q.token_label} · {q.customer_name}
            </span>
            <span className="text-ink/40">{q.source}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AdminServices() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({
    name: "",
    description: "",
    prefix: "",
    average_service_time: 6,
  });
  async function load() {
    setRows(await api("/services"));
  }
  useEffect(() => {
    load();
  }, []);
  async function create(e) {
    e.preventDefault();
    await api("/admin/services", { method: "POST", auth: "adminToken", body: form });
    setForm({ name: "", description: "", prefix: "", average_service_time: 6 });
    load();
  }
  return (
    <div>
      <h1 className="font-display text-4xl">Services</h1>
      <form onSubmit={create} className="mt-6 grid gap-3 md:grid-cols-2">
        <input
          className="rounded-2xl border border-ink/10 bg-white px-4 py-3"
          placeholder="Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          className="rounded-2xl border border-ink/10 bg-white px-4 py-3"
          placeholder="Prefix"
          value={form.prefix}
          onChange={(e) => setForm({ ...form, prefix: e.target.value })}
        />
        <input
          className="rounded-2xl border border-ink/10 bg-white px-4 py-3 md:col-span-2"
          placeholder="Description"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <button className="rounded-full bg-ink px-5 py-3 text-paper">Add service</button>
      </form>
      <ul className="mt-8 space-y-2">
        {rows.map((s) => (
          <li key={s.id} className="flex justify-between rounded-2xl bg-white px-4 py-3">
            <span>
              {s.name} ({s.prefix})
            </span>
            <button
              className="text-sm text-ticket"
              onClick={() =>
                api(`/admin/services/${s.id}`, {
                  method: "PATCH",
                  auth: "adminToken",
                  body: { active: false },
                }).then(load)
              }
            >
              Deactivate
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AdminCounters() {
  const [rows, setRows] = useState([]);
  const [staff, setStaff] = useState([]);
  const [services, setServices] = useState([]);
  const [number, setNumber] = useState(6);
  async function load() {
    const [c, s, sv] = await Promise.all([
      api("/admin/counters", { auth: "adminToken" }),
      api("/admin/staff", { auth: "adminToken" }),
      api("/services"),
    ]);
    setRows(c);
    setStaff(s);
    setServices(sv);
  }
  useEffect(() => {
    load();
  }, []);
  return (
    <div>
      <h1 className="font-display text-4xl">Counters</h1>
      <button
        className="mt-4 rounded-full bg-ink px-5 py-2 text-paper"
        onClick={() =>
          api("/admin/counters", {
            method: "POST",
            auth: "adminToken",
            body: { number, name: `Counter ${String(number).padStart(2, "0")}`, serviceIds: services.map((s) => s.id) },
          }).then(() => {
            setNumber(number + 1);
            load();
          })
        }
      >
        Add counter
      </button>
      <ul className="mt-6 space-y-3">
        {rows.map((c) => (
          <li key={c.id} className="rounded-3xl bg-white p-4">
            <div className="flex justify-between">
              <p className="font-display text-2xl">{c.name}</p>
              <p className="uppercase text-ink/40">{c.status}</p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <select
                className="rounded-xl border border-ink/10 px-2 py-1"
                value={c.staff_id || ""}
                onChange={(e) =>
                  api(`/admin/counters/${c.id}`, {
                    method: "PATCH",
                    auth: "adminToken",
                    body: { staffId: e.target.value || null },
                  }).then(load)
                }
              >
                <option value="">Unassigned</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() =>
                  api(`/admin/counters/${c.id}`, {
                    method: "PATCH",
                    auth: "adminToken",
                    body: { status: c.status === "paused" ? "available" : "paused" },
                  }).then(load)
                }
              >
                {c.status === "paused" ? "Activate" : "Pause"}
              </button>
              <button
                className="text-ticket"
                onClick={() =>
                  api(`/admin/counters/${c.id}`, {
                    method: "PATCH",
                    auth: "adminToken",
                    body: { active: false },
                  }).then(load)
                }
              >
                Deactivate
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AdminStaff() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ name: "", employeeId: "", password: "", role: "staff" });
  async function load() {
    setRows(await api("/admin/staff", { auth: "adminToken" }));
  }
  useEffect(() => {
    load();
  }, []);
  return (
    <div>
      <h1 className="font-display text-4xl">Staff accounts</h1>
      <form
        className="mt-6 grid gap-3 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          api("/admin/staff", { method: "POST", auth: "adminToken", body: form }).then(load);
        }}
      >
        <input
          className="rounded-2xl border border-ink/10 bg-white px-4 py-3"
          placeholder="Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          className="rounded-2xl border border-ink/10 bg-white px-4 py-3"
          placeholder="Staff ID"
          value={form.employeeId}
          onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
        />
        <input
          className="rounded-2xl border border-ink/10 bg-white px-4 py-3"
          placeholder="Password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <button className="rounded-full bg-ink px-5 py-3 text-paper">Create staff</button>
      </form>
      <ul className="mt-8 space-y-2">
        {rows.map((s) => (
          <li key={s.id} className="flex justify-between rounded-2xl bg-white px-4 py-3">
            <span>
              {s.name} · {s.employee_id}
            </span>
            <span className="uppercase text-ink/40">{s.role}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AdminAnalytics() {
  const [data, setData] = useState(null);
  useEffect(() => {
    api("/admin/analytics", { auth: "adminToken" }).then(setData);
  }, []);
  if (!data) return <p>Loading…</p>;
  return (
    <div>
      <h1 className="font-display text-4xl">Analytics</h1>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <Stat label="People served" value={data.servedToday} />
        <Stat label="Average wait" value={`${data.avgWait} min`} />
        <Stat label="Skipped tokens" value={data.skipped} />
      </div>
      <h2 className="mt-10 font-display text-2xl">Service time</h2>
      <ul className="mt-4 space-y-2">
        {data.serviceStats.map((s) => (
          <li key={s.id} className="rounded-2xl bg-white px-4 py-3">
            {s.name}: {s.average_service_time} min average service · {s.waiting} waiting
          </li>
        ))}
      </ul>
      <h2 className="mt-10 font-display text-2xl">Entry channels</h2>
      <ul className="mt-4 space-y-2">
        {Object.entries(data.bySource || {}).map(([k, v]) => (
          <li key={k} className="rounded-2xl bg-white px-4 py-3">
            {k}: {v}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AdminChannels() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    api("/admin/kiosks", { auth: "adminToken" }).then(setRows);
  }, []);
  return (
    <div>
      <h1 className="font-display text-4xl">Access channels</h1>
      <p className="mt-2 text-ink/60">Web, kiosk, and USSD/SMS entry points and sync status.</p>
      <ul className="mt-6 space-y-2">
        {rows.map((k) => (
          <li key={k.id} className="flex justify-between rounded-2xl bg-white px-4 py-3">
            <span>
              {k.name} · {k.location}
            </span>
            <span>{k.online ? "Synced" : "Offline"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AdminAlerts() {
  const [rows, setRows] = useState([]);
  async function load() {
    setRows(await api("/admin/alerts", { auth: "adminToken" }));
  }
  useEffect(() => {
    load();
  }, []);
  return (
    <div>
      <h1 className="font-display text-4xl">Alerts</h1>
      <ul className="mt-6 space-y-2">
        {rows.map((a) => (
          <li key={a.id} className="rounded-2xl bg-white px-4 py-3">
            <p className="font-medium">{a.title}</p>
            <p className="text-sm text-ink/60">{a.message}</p>
            {!a.is_read && (
              <button
                className="mt-2 text-sm text-teal"
                onClick={() =>
                  api(`/admin/alerts/${a.id}`, { method: "PATCH", auth: "adminToken" }).then(load)
                }
              >
                Mark read
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AdminSettings() {
  return (
    <div>
      <h1 className="font-display text-4xl">Settings</h1>
      <p className="mt-4 max-w-xl text-ink/70">
        ETA starts as people ahead × average service time ÷ active counters. Average
        service time is seeded per service and can be improved from completed tickets.
      </p>
      <p className="mt-4 text-sm text-ink/50">
        Shared queue: any eligible counter can call the next token. Counters only
        receive services they are assigned to handle.
      </p>
    </div>
  );
}
