const { supabase } = require("./db");

function activeCounterFilter(status) {
  return status === "available" || status === "serving";
}

async function getQueueSnapshot(serviceId) {
  const { data: service, error: serviceError } = await supabase
    .from("services")
    .select("*")
    .eq("id", serviceId)
    .single();
  if (serviceError) throw serviceError;

  const [{ data: waiting }, { data: counters }] = await Promise.all([
    supabase
      .from("queues")
      .select("*")
      .eq("service_id", serviceId)
      .eq("status", "waiting")
      .order("joined_at", { ascending: true }),
    supabase.from("counters").select("*"),
  ]);

  const { data: counterServices } = await supabase
    .from("counter_services")
    .select("*")
    .eq("service_id", serviceId);

  const eligibleIds = new Set((counterServices || []).map((row) => row.counter_id));
  const activeCounters = (counters || []).filter(
    (c) => eligibleIds.has(c.id) && activeCounterFilter(c.status)
  );

  const peopleWaiting = waiting?.length || 0;
  const divisor = Math.max(activeCounters.length, 1);
  const etaMinutes = Math.round(
    (peopleWaiting * (service.average_service_time || 5)) / divisor
  );

  return {
    service,
    waiting: waiting || [],
    peopleWaiting,
    activeCounters: activeCounters.length,
    etaMinutes,
  };
}

async function nextTokenNumber(serviceId) {
  const { data, error } = await supabase
    .from("queues")
    .select("token_number")
    .eq("service_id", serviceId)
    .order("token_number", { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data?.[0]?.token_number || 100) + 1;
}

function tokenLabel(prefix, number) {
  return `#${prefix}${String(number).padStart(3, "0")}`;
}

async function joinQueue({ serviceId, customerName, contact, source = "web" }) {
  const { data: service, error: serviceError } = await supabase
    .from("services")
    .select("*")
    .eq("id", serviceId)
    .eq("active", true)
    .single();
  if (serviceError || !service) {
    const err = new Error("Service not found");
    err.status = 404;
    throw err;
  }

  const tokenNumber = await nextTokenNumber(serviceId);
  const { data, error } = await supabase
    .from("queues")
    .insert({
      service_id: serviceId,
      token_number: tokenNumber,
      token_label: tokenLabel(service.prefix, tokenNumber),
      customer_name: customerName,
      contact,
      status: "waiting",
      source,
    })
    .select()
    .single();
  if (error) throw error;

  const snapshot = await getQueueSnapshot(serviceId);
  const peopleAhead = snapshot.waiting.filter(
    (row) => row.joined_at < data.joined_at
  ).length;
  const etaMinutes = Math.round(
    (peopleAhead * (service.average_service_time || 5)) /
      Math.max(snapshot.activeCounters, 1)
  );

  return { ticket: data, peopleAhead, etaMinutes, snapshot };
}

async function trackerPayload(ticketId) {
  const { data: ticket, error } = await supabase
    .from("queues")
    .select("*, services(*), counters(*)")
    .eq("id", ticketId)
    .single();
  if (error || !ticket) {
    const err = new Error("Ticket not found");
    err.status = 404;
    throw err;
  }

  const snapshot = await getQueueSnapshot(ticket.service_id);
  const peopleAhead = snapshot.waiting.filter(
    (row) => row.joined_at < ticket.joined_at && row.id !== ticket.id
  ).length;
  const etaMinutes =
    ticket.status === "waiting"
      ? Math.round(
          (peopleAhead * (ticket.services?.average_service_time || 5)) /
            Math.max(snapshot.activeCounters, 1)
        )
      : 0;

  return {
    ticket,
    peopleAhead,
    etaMinutes,
    peopleWaiting: snapshot.peopleWaiting,
    activeCounters: snapshot.activeCounters,
    approaching: ticket.status === "waiting" && peopleAhead <= 2,
  };
}

async function callNext(counterId) {
  const { data: counter, error: counterError } = await supabase
    .from("counters")
    .select("*")
    .eq("id", counterId)
    .single();
  if (counterError || !counter) {
    const err = new Error("Counter not found");
    err.status = 404;
    throw err;
  }

  const { data: links } = await supabase
    .from("counter_services")
    .select("service_id")
    .eq("counter_id", counterId);
  const serviceIds = (links || []).map((row) => row.service_id);
  if (!serviceIds.length) {
    const err = new Error("This counter has no assigned services");
    err.status = 400;
    throw err;
  }

  const { data: current } = await supabase
    .from("queues")
    .select("*")
    .eq("counter_id", counterId)
    .in("status", ["called", "serving"])
    .limit(1);
  if (current?.length) {
    const err = new Error("Finish or skip the current customer first");
    err.status = 409;
    throw err;
  }

  const { data: waiting, error: waitError } = await supabase
    .from("queues")
    .select("*")
    .in("service_id", serviceIds)
    .eq("status", "waiting")
    .order("joined_at", { ascending: true })
    .limit(1);
  if (waitError) throw waitError;
  if (!waiting?.length) {
    const err = new Error("No eligible customers waiting");
    err.status = 404;
    throw err;
  }

  const ticket = waiting[0];
  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("queues")
    .update({
      status: "serving",
      counter_id: counterId,
      called_at: now,
      started_at: now,
    })
    .eq("id", ticket.id)
    .select("*, services(*)")
    .single();
  if (error) throw error;

  await supabase.from("counters").update({ status: "serving" }).eq("id", counterId);
  return updated;
}

async function completeCurrent(counterId) {
  const { data: ticket, error } = await supabase
    .from("queues")
    .select("*")
    .eq("counter_id", counterId)
    .in("status", ["called", "serving"])
    .order("called_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!ticket) {
    const err = new Error("No customer at this counter");
    err.status = 404;
    throw err;
  }

  const { data: updated, error: updateError } = await supabase
    .from("queues")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", ticket.id)
    .select()
    .single();
  if (updateError) throw updateError;

  await supabase.from("counters").update({ status: "available" }).eq("id", counterId);
  return updated;
}

async function skipCurrent(counterId) {
  const { data: ticket, error } = await supabase
    .from("queues")
    .select("*")
    .eq("counter_id", counterId)
    .in("status", ["called", "serving"])
    .order("called_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!ticket) {
    const err = new Error("No customer at this counter");
    err.status = 404;
    throw err;
  }

  const { data: updated, error: updateError } = await supabase
    .from("queues")
    .update({ status: "skipped", completed_at: new Date().toISOString() })
    .eq("id", ticket.id)
    .select()
    .single();
  if (updateError) throw updateError;

  await supabase.from("counters").update({ status: "available" }).eq("id", counterId);
  return updated;
}

async function overview() {
  const [{ data: queues }, { data: counters }, { data: services }] = await Promise.all([
    supabase.from("queues").select("*"),
    supabase.from("counters").select("*, staff(id, name, employee_id, role)"),
    supabase.from("services").select("*"),
  ]);

  const waiting = (queues || []).filter((q) => q.status === "waiting");
  const serving = (queues || []).filter((q) => q.status === "serving" || q.status === "called");
  const completedToday = (queues || []).filter((q) => q.status === "completed");
  const skipped = (queues || []).filter((q) => q.status === "skipped");
  const activeCounters = (counters || []).filter((c) => activeCounterFilter(c.status));

  const serviceStats = (services || []).map((service) => {
    const waitingForService = waiting.filter((q) => q.service_id === service.id);
    const eta = Math.round(
      (waitingForService.length * (service.average_service_time || 5)) /
        Math.max(activeCounters.length, 1)
    );
    let health = "calm";
    if (eta >= 30) health = "hot";
    else if (eta >= 20) health = "busy";
    return {
      ...service,
      waiting: waitingForService.length,
      avgWait: eta,
      health,
    };
  });

  const waits = completedToday
    .filter((q) => q.joined_at && q.completed_at)
    .map((q) => (new Date(q.completed_at) - new Date(q.joined_at)) / 60000);
  const avgWait = waits.length
    ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length)
    : serviceStats.reduce((sum, s) => sum + s.avgWait, 0) /
        Math.max(serviceStats.length, 1);

  return {
    waiting: waiting.length,
    countersOnline: `${activeCounters.length} / ${(counters || []).length}`,
    activeCounterCount: activeCounters.length,
    counterTotal: (counters || []).length,
    avgWait: Math.round(avgWait || 0),
    servedToday: completedToday.length,
    skipped: skipped.length,
    cancelled: (queues || []).filter((q) => q.status === "left").length,
    currentlyServing: serving,
    serviceStats,
    counters: counters || [],
    queues: queues || [],
  };
}

module.exports = {
  getQueueSnapshot,
  joinQueue,
  trackerPayload,
  callNext,
  completeCurrent,
  skipCurrent,
  overview,
  activeCounterFilter,
};
