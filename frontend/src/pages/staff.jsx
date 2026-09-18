import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, session } from "../api";

export function StaffLogin() {
  const [employeeId, setEmployeeId] = useState("STAFF03");
  const [password, setPassword] = useState("staff123");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function submit(e) {
    e.preventDefault();
    try {
      const data = await api("/auth/login", {
        method: "POST",
        body: { employeeId, password },
      });
      if (data.user.role === "admin") {
        localStorage.setItem("adminToken", data.token);
        session.save("adminUser", data.user);
        navigate("/admin");
        return;
      }
      localStorage.setItem("staffToken", data.token);
      session.save("staffUser", data.user);
      navigate("/staff");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="mx-auto max-w-md px-6 py-16">
      <p className="font-display text-2xl">DeQueue</p>
      <h1 className="mt-4 font-display text-4xl">Staff login</h1>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <input
          className="w-full rounded-2xl border border-ink/10 bg-white px-4 py-3"
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          placeholder="Staff ID"
        />
        <input
          type="password"
          className="w-full rounded-2xl border border-ink/10 bg-white px-4 py-3"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-ticket">{error}</p>}
        <button className="w-full rounded-full bg-ink py-3 text-paper">Enter dashboard</button>
      </form>
      <p className="mt-6 text-sm text-ink/50">Demo: STAFF03 / staff123</p>
    </section>
  );
}

export function StaffDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      setData(await api("/staff/dashboard", { auth: "staffToken" }));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  async function act(path) {
    try {
      await api(path, { method: "POST", auth: "staffToken" });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!data) return <p>{error || "Loading dashboard…"}</p>;
  const { counter, current, upcoming, overview, user } = data;
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-ink/50">
            {counter?.name || "Unassigned"} · {counter?.status?.toUpperCase() || "NO COUNTER"}
          </p>
          <h1 className="font-display text-4xl">
            {hello}, {user.name} 
          </h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => act("/staff/counter-status")}
            className="hidden"
          />
          <button
            className="rounded-full border border-ink/20 px-4 py-2 text-sm"
            onClick={() =>
              api("/staff/counter-status", {
                method: "POST",
                auth: "staffToken",
                body: { status: counter?.status === "paused" ? "available" : "paused" },
              }).then(load)
            }
          >
            {counter?.status === "paused" ? "Resume counter" : "Pause counter"}
          </button>
        </div>
      </div>

      {error && <p className="mt-4 text-ticket">{error}</p>}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-3xl bg-white p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-ink/40">Current customer</p>
          {current ? (
            <>
              <p className="mt-4 font-display text-5xl">{current.token_label}</p>
              <p className="mt-2 text-ink/70">{current.services?.name}</p>
              <p className="text-sm text-ink/50">{current.customer_name}</p>
              <div className="mt-6 flex flex-wrap gap-2">
                <button
                  onClick={() => act("/staff/complete")}
                  className="rounded-full bg-teal px-5 py-2 text-paper"
                >
                  Complete service
                </button>
                <button
                  onClick={() => act("/staff/skip")}
                  className="rounded-full border border-ink/20 px-5 py-2"
                >
                  Skip
                </button>
              </div>
            </>
          ) : (
            <p className="mt-6 text-ink/60">Counter is free. Call the next eligible token.</p>
          )}
        </div>
        <div className="rounded-3xl bg-ink p-6 text-paper">
          <p className="text-xs uppercase tracking-[0.2em] text-paper/40">Queue overview</p>
          <div className="mt-6 grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-paper/50">Waiting</p>
              <p className="text-3xl">{overview.waiting}</p>
            </div>
            <div>
              <p className="text-paper/50">Counters</p>
              <p className="text-3xl">{overview.activeCounterCount}</p>
            </div>
            <div>
              <p className="text-paper/50">Avg wait</p>
              <p className="text-3xl">{overview.avgWait}m</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-3xl bg-white p-6">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.2em] text-ink/40">Next customers</p>
          <button
            onClick={() => act("/staff/call-next")}
            className="rounded-full bg-ticket px-5 py-2 text-sm text-paper"
          >
            Call next
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          {upcoming.map((row) => (
            <div key={row.id} className="rounded-2xl border border-ink/10 px-4 py-3">
              <p className="font-display text-2xl">{row.token_label}</p>
              <p className="text-xs text-ink/50">{row.services?.name}</p>
            </div>
          ))}
          {!upcoming.length && <p className="text-ink/50">No one waiting for this counter.</p>}
        </div>
      </div>

      <div className="mt-6 rounded-3xl border border-ink/10 p-6">
        <p className="text-xs uppercase tracking-[0.2em] text-ink/40">Counter status</p>
        <ul className="mt-4 grid gap-2 md:grid-cols-2">
          {overview.counters.map((c) => (
            <li key={c.id} className="flex justify-between text-sm">
              <span>{c.name}</span>
              <span className="uppercase text-ink/50">
                {c.id === counter?.id ? "Your counter" : c.status}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function StaffQueue() {
  const [data, setData] = useState(null);
  useEffect(() => {
    api("/staff/dashboard", { auth: "staffToken" }).then(setData).catch(() => {});
  }, []);
  return (
    <div>
      <h1 className="font-display text-4xl">My queue</h1>
      <ol className="mt-6 space-y-2">
        {(data?.upcoming || []).map((row, i) => (
          <li key={row.id} className="flex justify-between rounded-2xl bg-white px-4 py-3">
            <span>
              {row.token_label} · {row.customer_name}
            </span>
            <span className="text-ink/40">{i + 1}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function StaffHistory() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    api("/staff/history", { auth: "staffToken" }).then(setRows).catch(() => {});
  }, []);
  return (
    <div>
      <h1 className="font-display text-4xl">Completed services</h1>
      <ul className="mt-6 space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="flex justify-between rounded-2xl bg-white px-4 py-3 text-sm">
            <span>
              {row.token_label} · {row.services?.name}
            </span>
            <span className="uppercase text-ink/40">{row.status}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
