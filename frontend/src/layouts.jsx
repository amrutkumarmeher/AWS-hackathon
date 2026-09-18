import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { session } from "./api";

export function PublicHeader() {
  const customer = session.read("customer");
  return (
    <header className="flex items-center justify-between px-6 py-5 md:px-10">
      <NavLink to="/" className="font-display text-2xl tracking-tight">
        DeQueue
      </NavLink>
      <nav className="flex items-center gap-5 text-sm">
        <NavLink to="/services" className="hover:text-teal">
          Services
        </NavLink>
        <NavLink to="/how-it-works" className="hover:text-teal">
          How it works
        </NavLink>
        <NavLink
          to="/login"
          className="rounded-full bg-ink px-4 py-2 text-paper"
        >
          {customer ? "Your queue" : "Login"}
        </NavLink>
      </nav>
    </header>
  );
}

export function PublicLayout() {
  return (
    <div className="min-h-screen bg-paper">
      <PublicHeader />
      <Outlet />
    </div>
  );
}

function SideLink({ to, children, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `block rounded-xl px-3 py-2 text-sm ${
          isActive ? "bg-ink text-paper" : "text-ink/80 hover:bg-ink/5"
        }`
      }
    >
      {children}
    </NavLink>
  );
}

export function StaffLayout() {
  const navigate = useNavigate();
  const user = session.read("staffUser");
  return (
    <div className="min-h-screen bg-[#efe6d8] md:grid md:grid-cols-[240px_1fr]">
      <aside className="border-b border-ink/10 p-5 md:border-b-0 md:border-r">
        <p className="font-display text-xl">DeQueue</p>
        <p className="mt-1 text-xs uppercase tracking-[0.2em] text-ink/50">Staff</p>
        <nav className="mt-8 space-y-1">
          <SideLink to="/staff" end>
            Dashboard
          </SideLink>
          <SideLink to="/staff/queue">Queue</SideLink>
          <SideLink to="/staff/history">History</SideLink>
        </nav>
        <button
          className="mt-10 text-sm text-ink/60"
          onClick={() => {
            session.clear(["staffToken", "staffUser"]);
            navigate("/staff/login");
          }}
        >
          Sign out {user?.name ? `· ${user.name}` : ""}
        </button>
      </aside>
      <main className="p-6 md:p-8">
        <Outlet />
      </main>
    </div>
  );
}

export function AdminLayout() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-[#efe6d8] md:grid md:grid-cols-[240px_1fr]">
      <aside className="border-b border-ink/10 p-5 md:border-b-0 md:border-r">
        <p className="font-display text-xl">DeQueue</p>
        <p className="mt-1 text-xs uppercase tracking-[0.2em] text-teal">Admin panel</p>
        <nav className="mt-8 space-y-1">
          <SideLink to="/admin" end>
            Dashboard
          </SideLink>
          <SideLink to="/admin/queues">Queues</SideLink>
          <SideLink to="/admin/services">Services</SideLink>
          <SideLink to="/admin/counters">Counters</SideLink>
          <SideLink to="/admin/staff">Staff</SideLink>
          <SideLink to="/admin/analytics">Analytics</SideLink>
          <SideLink to="/admin/channels">Access channels</SideLink>
          <SideLink to="/admin/alerts">Alerts</SideLink>
          <SideLink to="/admin/settings">Settings</SideLink>
        </nav>
        <button
          className="mt-10 text-sm text-ink/60"
          onClick={() => {
            session.clear(["adminToken", "adminUser"]);
            navigate("/admin/login");
          }}
        >
          Sign out
        </button>
      </aside>
      <main className="p-6 md:p-8">
        <Outlet />
      </main>
    </div>
  );
}

export function Guard({ role, children }) {
  const tokenKey = role === "admin" ? "adminToken" : "staffToken";
  const user = session.read(role === "admin" ? "adminUser" : "staffUser");
  const token = localStorage.getItem(tokenKey);
  if (!token || (role === "admin" && user?.role !== "admin")) {
    return (
      <div className="p-10">
        Session missing.{" "}
        <a className="underline" href={role === "admin" ? "/admin/login" : "/staff/login"}>
          Sign in
        </a>
      </div>
    );
  }
  return children;
}
