// Supabase Edge Function "agenda" — publica os prazos do escritório como agenda para o Google Agenda assinar
// Painel do Supabase -> Edge Functions -> Deploy a new function -> Via Editor
// Nome: agenda  |  cole este código  |  DESLIGUE "Verify JWT"  |  Deploy
// A proteção é o código secreto do endereço (gerado em Configurações > Integrações, no sistema).

import { createClient } from "npm:@supabase/supabase-js@2";

type Obj = Record<string, any>;
const somaDias = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const hojeBrasil = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const esc = (s: unknown) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const dobra = (l: string) => { let o = ""; while (l.length > 74) { o += l.slice(0, 74) + "\r\n "; l = l.slice(74); } return o + l; };

Deno.serve(async (req: Request) => {
  const t = new URL(req.url).searchParams.get("t") || "";
  if (t.length < 16) return new Response("Não autorizado", { status: 401 });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: rows, error } = await sb.from("crm_store").select("key,data").in("key", ["jur_cfg", "jur_pz", "jur_i", "jur_p", "jur_tar", "jur_lb"]);
  if (error) return new Response("Erro", { status: 500 });
  const pega = (k: string): any => rows?.find((r: Obj) => r.key === k)?.data;
  const cfg: Obj = pega("jur_cfg") || {};
  if (!cfg.agendaToken || cfg.agendaToken !== t) return new Response("Não autorizado", { status: 401 });
  const prazos: Obj[] = pega("jur_pz") || [], intims: Obj[] = pega("jur_i") || [], procs: Obj[] = pega("jur_p") || [];
  const tarefas: Obj[] = pega("jur_tar") || [], lembretes: Obj[] = pega("jur_lb") || [];
  const proc = (id: string): Obj => procs.find((p) => p.id === id) || {};
  const ev: { uid: string; data: string; titulo: string; desc: string; hora?: string; horaFim?: string; local?: string }[] = [];
  const mais1h = (h: string) => { const [a, b] = h.split(":").map(Number); const m = Math.min(1439, a * 60 + (b || 0) + 60); return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
  const ligados = new Set<string>();
  prazos.filter((z) => !z.cumprido && z.limite).forEach((z) => {
    if (z.intimId) ligados.add(z.intimId);
    const p = proc(z.procId);
    ev.push({ uid: "pz-" + z.id, data: z.limite, hora: z.hora || "", titulo: (z.tipo === "audiencia" ? "Audiência: " : "Prazo: ") + z.desc + (p.cli ? " — " + p.cli : ""),
      desc: [p.num ? "Processo " + p.num : "", z.estimado ? "Prazo estimado automaticamente — conferir." : "", z.obs || ""].filter(Boolean).join("\n") });
  });
  intims.filter((i) => i.st === "pendente" && i.pz && !ligados.has(i.id)).forEach((i) => {
    const p = proc(i.procId); ev.push({ uid: "in-" + i.id, data: i.pz, titulo: "Intimação: " + (p.cli || i.numProc || ""), desc: String(i.teor || "").slice(0, 500) });
  });
  procs.filter((p) => p.pz && p.st !== "Arquivado" && p.st !== "Concluído").forEach((p) => ev.push({ uid: "pr-" + p.id, data: p.pz, titulo: "Prazo/audiência: " + p.cli, desc: p.num ? "Processo " + p.num : "" }));
  tarefas.filter((x) => !x.done && x.prazo).forEach((x) => ev.push({ uid: "ta-" + x.id, data: x.prazo, titulo: "Tarefa: " + x.titulo, desc: "" }));
  lembretes.filter((l) => l.data).forEach((l) => ev.push({ uid: "lb-" + l.id, data: l.data, hora: l.hora || "", horaFim: l.horaFim || "", local: l.local || "", titulo: l.texto, desc: [l.cat, l.obs].filter(Boolean).join("\n") }));
  const corte = somaDias(hojeBrasil(), -30);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Guerra e Torres//Agenda Juridica//PT", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:" + esc(((cfg.escritorio && cfg.escritorio.nome) || "Guerra & Torres Advocacia") + " — agenda"), "X-WR-TIMEZONE:America/Sao_Paulo", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H",
    "BEGIN:VTIMEZONE", "TZID:America/Sao_Paulo", "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:-0300", "TZOFFSETTO:-0300", "TZNAME:-03", "END:STANDARD", "END:VTIMEZONE"];
  ev.filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.data) && e.data >= corte).forEach((e) => {
    const d = e.data.replace(/-/g, "");
    const quando = e.hora && /^\d{2}:\d{2}$/.test(e.hora)
      ? ["DTSTART;TZID=America/Sao_Paulo:" + d + "T" + e.hora.replace(":", "") + "00", "DTEND;TZID=America/Sao_Paulo:" + d + "T" + (e.horaFim && e.horaFim > e.hora ? e.horaFim : mais1h(e.hora)).replace(":", "") + "00"]
      : ["DTSTART;VALUE=DATE:" + d, "DTEND;VALUE=DATE:" + somaDias(e.data, 1).replace(/-/g, "")];
    L.push("BEGIN:VEVENT", "UID:" + e.uid + "@guerraetorres", "DTSTAMP:" + stamp, ...quando,
      "SUMMARY:" + esc(e.titulo), "DESCRIPTION:" + esc(e.desc), ...(e.local ? ["LOCATION:" + esc(e.local)] : []), e.hora ? "TRANSP:OPAQUE" : "TRANSP:TRANSPARENT",
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + esc(e.titulo), "TRIGGER:" + (e.hora ? "-PT30M" : "-PT15H"), "END:VALARM", "END:VEVENT");
  });
  L.push("END:VCALENDAR");
  return new Response(L.map(dobra).join("\r\n") + "\r\n", { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-cache" } });
});
