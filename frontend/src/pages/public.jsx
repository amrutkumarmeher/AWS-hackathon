import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, session } from "./api";

export function Landing() {
  return (
    <section className="px-6 pb-20 md:px-10">
      <div className="mt-8 grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="text-sm uppercase tracking-[0.25em] text-ticket">Public queues, privately timed</p>
          <h1 className="mt-4 font-display text-5xl leading-[1.05] md:text-7xl">
            Know your turn.
            <br />
            Plan your time.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-ink/70">
            No more guessing how long the queue will take. Get a token, watch your
            position, and walk in when it is actually your turn.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/services" className="rounded-full bg-ticket px-6 py-3 text-paper">
              Join a queue
            </Link>
            <Link to="/how-it-works" className="rounded-full border border-ink/20 px-6 py-3">
              How it works
            </Link>
            <Link to="/staff/login" className="rounded-full border border-ink/20 px-6 py-3">
              Staff
            </Link>
            <Link to="/admin/login" className="rounded-full border border-ink/20 px-6 py-3">
              Admin
            </Link>
          </div>
        </div>
        <div className="relative">
          <div className="absolute inset-x-8 -top-4 h-full rounded-3xl bg-teal/20" />
          <div className="relative rotate-2 rounded-3xl bg-ink p-8 text-paper shadow-2xl">
            <p className="text-xs uppercase tracking-[0.3em] text-gold">Live token</p>
            <p className="mt-6 font-display text-6xl">#A124</p>
            <div className="mt-8 grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-paper/50">Position</p>
                <p className="text-xl">3</p>
              </div>
              <div>
                <p className="text-paper/50">ETA</p>
                <p className="text-xl">18 min</p>
              </div>
              <div>
                <p className="text-paper/50">Status</p>
                <p className="text-xl">Waiting</p>
              </div>
            </div>
            <div className="ticket-perforation mt-8 h-4 w-full opacity-40" />
          </div>
        </div>
      </div>
    </section>
  );
}

export function HowItWorks() {
  const steps = [
    "Pick a service",
    "Join with name and phone",
    "Get a token",
    "Track position and ETA",
    "Get called to a counter",
    "Rate the service",
  ];
  return (
    <section className="px-6 pb-20 md:px-10">
      <h1 className="font-display text-4xl">How DeQueue works</h1>
      <p className="mt-3 max-w-2xl text-ink/70">
        One shared queue feeds every eligible counter. When a desk becomes free,
        staff taps Call next and the next person in line is assigned.
      </p>
      <ol className="mt-10 grid gap-4 md:grid-cols-2">
        {steps.map((step, i) => (
          <li key={step} className="rounded-2xl border border-ink/10 bg-white/50 p-5">
            <span className="text-ticket">{String(i + 1).padStart(2, "0")}</span>
            <p className="mt-2 font-display text-2xl">{step}</p>
          </li>
        ))}
      </ol>
      <p className="mt-10 text-sm text-ink/60">
        Access channels: web / PWA, kiosk, and USSD. Staff and admin use ID + password.
      </p>
    </section>
  );
}

export function ServicesPage() {
  const [services, setServices] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/services")
      .then(setServices)
      .catch((err) => setError(err.message));
  }, []);
  return (
    <section className="px-6 pb-20 md:px-10">
      <h1 className="font-display text-4xl">Services</h1>
      {error && <p className="mt-4 text-ticket">{error}</p>}
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {services.map((s) => (
          <Link
            key={s.id}
            to={`/services/${s.id}`}
            className="rounded-3xl border border-ink/10 bg-white/70 p-6 hover:border-teal"
          >
            <p className="text-xs uppercase tracking-[0.2em] text-teal">Token {s.prefix}</p>
            <h2 className="mt-2 font-display text-3xl">{s.name}</h2>
            <p className="mt-2 text-ink/70">{s.description}</p>
            <p className="mt-6 text-sm">
              {s.peopleWaiting} waiting · ~{s.etaMinutes} min
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function ServiceDetail() {
  const { id } = useParams();
  const [snap, setSnap] = useState(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const customer = session.read("customer");

  useEffect(() => {
    api(`/services/${id}`)
      .then(setSnap)
      .catch((err) => setError(err.message));
  }, [id]);

  async function join() {
    if (!customer) {
      session.save("pendingService", { id });
      navigate("/login");
      return;
    }
    try {
      const result = await api("/queue/join", {
        method: "POST",
        body: {
          serviceId: id,
          customerName: customer.name,
          contact: customer.phone,
          source: "web",
        },
      });
      localStorage.setItem("ticketId", result.ticket.id);
      navigate(`/queue/${result.ticket.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  if (!snap && !error) return <p className="px-10">Loading…</p>;
  return (
    <section className="px-6 pb-20 md:px-10">
      {error && <p className="text-ticket">{error}</p>}
      {snap && (
        <>
          <p className="text-sm uppercase tracking-[0.2em] text-teal">Service</p>
          <h1 className="mt-2 font-display text-5xl">{snap.service.name}</h1>
          <p className="mt-3 max-w-xl text-ink/70">{snap.service.description}</p>
          <div className="mt-8 flex gap-6 text-sm">
            <span>{snap.peopleWaiting} in line</span>
            <span>{snap.activeCounters} active counters</span>
            <span>~{snap.etaMinutes} min wait</span>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <button onClick={join} className="rounded-full bg-ticket px-6 py-3 text-paper">
              Join queue
            </button>
            <Link to={`/queue/live/${id}`} className="rounded-full border border-ink/20 px-6 py-3">
              View queue
            </Link>
          </div>
        </>
      )}
    </section>
  );
}

export function CustomerLogin() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function submit(e) {
    e.preventDefault();
    try {
      const data = await api("/customers/session", {
        method: "POST",
        body: { name, phone },
      });
      localStorage.setItem("customerToken", data.token);
      session.save("customer", data.customer);
      const pending = session.read("pendingService");
      if (pending?.id) {
        session.clear(["pendingService"]);
        navigate(`/services/${pending.id}`);
      } else {
        navigate("/services");
      }
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="mx-auto max-w-md px-6 pb-20">
      <h1 className="font-display text-4xl">Customer login</h1>
      <p className="mt-2 text-ink/70">Use your name and phone number. No password.</p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <input
          className="w-full rounded-2xl border border-ink/10 bg-white px-4 py-3"
          placeholder="Full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="w-full rounded-2xl border border-ink/10 bg-white px-4 py-3"
          placeholder="Phone number"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        {error && <p className="text-ticket">{error}</p>}
        <button className="w-full rounded-full bg-ink py-3 text-paper">Continue</button>
      </form>
    </section>
  );
}

export function Tracker() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    let timer;
    async function load() {
      try {
        setData(await api(`/queue/${id}`));
      } catch (err) {
        setError(err.message);
      }
    }
    load();
    timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [id]);

  if (error) return <p className="px-10 text-ticket">{error}</p>;
  if (!data) return <p className="px-10">Syncing your ticket…</p>;
  const { ticket } = data;
  const status = ticket.status;

  return (
    <section className="px-6 pb-20 md:px-10">
      <p className="text-sm uppercase tracking-[0.25em] text-gold">Queue tracker</p>
      <div className="mt-6 max-w-xl rounded-3xl bg-ink p-8 text-paper">
        <p className="text-paper/50">{ticket.services?.name}</p>
        <p className="mt-2 font-display text-6xl">{ticket.token_label}</p>
        <div className="mt-8 grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-paper/50">Position</p>
            <p className="text-2xl">{status === "waiting" ? data.peopleAhead + 1 : "—"}</p>
          </div>
          <div>
            <p className="text-paper/50">ETA</p>
            <p className="text-2xl">{data.etaMinutes} min</p>
          </div>
          <div>
            <p className="text-paper/50">Status</p>
            <p className="text-2xl capitalize">{status}</p>
          </div>
        </div>
        {data.approaching && status === "waiting" && (
          <p className="mt-6 rounded-2xl bg-gold/20 px-4 py-3 text-gold">Your turn is approaching.</p>
        )}
        {status === "serving" && (
          <p className="mt-6 rounded-2xl bg-teal/30 px-4 py-3">
            Your turn — go to {ticket.counters?.name || "your assigned counter"}.
          </p>
        )}
        {status === "completed" && (
          <button
            className="mt-6 rounded-full bg-paper px-5 py-2 text-ink"
            onClick={() => navigate(`/rate/${ticket.id}`)}
          >
            Rate service
          </button>
        )}
      </div>
      <p className="mt-6 text-sm text-ink/60">
        If you go offline, this last synced screen stays available when you return.
      </p>
    </section>
  );
}

export function LiveQueue() {
  const { id } = useParams();
  const [snap, setSnap] = useState(null);
  useEffect(() => {
    const load = () => api(`/queue/live/${id}`).then(setSnap).catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [id]);
  return (
    <section className="px-6 pb-20 md:px-10">
      <h1 className="font-display text-4xl">{snap?.service?.name || "Live queue"}</h1>
      <p className="mt-2 text-ink/70">
        {snap?.peopleWaiting ?? "—"} waiting · {snap?.activeCounters ?? "—"} counters · ETA {snap?.etaMinutes ?? "—"} min
      </p>
      <ol className="mt-8 space-y-2">
        {(snap?.waiting || []).map((row, i) => (
          <li key={row.id} className="flex justify-between rounded-2xl bg-white/70 px-4 py-3">
            <span className="font-display text-xl">{row.token_label}</span>
            <span className="text-sm text-ink/50">#{i + 1}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function RatePage() {
  const { id } = useParams();
  const [rating, setRating] = useState(5);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    try {
      await api(`/queue/${id}/rate`, { method: "POST", body: { rating } });
      setDone(true);
    } catch (err) {
      setError(err.message);
    }
  }
  if (done) {
    return (
      <section className="px-10 pb-20">
        <h1 className="font-display text-4xl">Thank you</h1>
        <Link to="/" className="mt-6 inline-block text-teal">
          Back home
        </Link>
      </section>
    );
  }
  return (
    <form onSubmit={submit} className="px-6 pb-20 md:px-10">
      <h1 className="font-display text-4xl">Rate this service</h1>
      <input
        type="range"
        min="1"
        max="5"
        value={rating}
        onChange={(e) => setRating(Number(e.target.value))}
        className="mt-8 w-64"
      />
      <p className="mt-2">{rating} / 5</p>
      {error && <p className="text-ticket">{error}</p>}
      <button className="mt-6 rounded-full bg-ink px-6 py-3 text-paper">Submit</button>
    </form>
  );
}
