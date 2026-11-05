// Supabase Edge Function "djen-diario" — robô que consulta o DJEN, calcula o prazo estimado pelo calendário
// do tribunal, liga a publicação ao cliente/processo e atualiza os andamentos pelo DataJud.
// Painel do Supabase -> Edge Functions -> Deploy a new function -> Via Editor
// Nome: djen-diario   |  cole este código  |  Deploy
// IMPORTANTE: ao publicar, DESLIGUE a opção "Verify JWT" (a proteção é a senha CRON_SECRET).
// A senha NÃO fica no código: Edge Functions -> Secrets -> Add new secret -> nome CRON_SECRET.
// O agendamento (7h e 12h, seg a sex) é feito pelo arquivo supabase/sql/04_agendamento_robo.sql,
// que lê a mesma senha guardada no cofre (Vault) do Supabase.

import { createClient } from "npm:@supabase/supabase-js@2";

// OABs monitoradas (número/UF)
const OABS = [
  { n: "53087", uf: "GO" }, // Paulo Henrique Braga Torres
  { n: "72570", uf: "GO" }, // Allane Ferreira Guerra
];
// Senha que só o agendamento conhece — vem dos Secrets do Supabase (a mesma guardada no Vault)
const SENHA_AGENDAMENTO = Deno.env.get("CRON_SECRET") ?? "";
const DIAS_ATRAS = 4; // cobre fim de semana e feriado prolongado
const API = "https://comunicaapi.pje.jus.br/api/v1/comunicacao";
const DATAJUD_CHAVE = "APIKey cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==";

type Obj = Record<string, any>;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);
const soDigitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const normTxt = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function hojeBrasil(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
function somaDias(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function htmlParaTexto(h: unknown): string {
  if (!h) return "";
  return String(h)
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m: string, c: string) => String.fromCharCode(Number(c)))
    .replace(/\n{3,}/g, "\n\n").trim();
}

// ---------- PRAZOS (mesmo calendário e mesmas regras do sistema; estimativa conservadora) ----------
let CFG: Obj = {};
const CAL_2026: Record<string, Record<string, string>> = {
  TJGO: { "2026-02-16": "Carnaval", "2026-02-17": "Carnaval", "2026-02-18": "Carnaval (até 12h)", "2026-04-01": "Semana Santa", "2026-04-02": "Semana Santa", "2026-04-03": "Semana Santa", "2026-04-20": "Ponto facultativo TJGO", "2026-06-04": "Corpus Christi", "2026-06-05": "Ponto facultativo TJGO", "2026-10-28": "Dia do Servidor Público (estadual)", "2026-12-08": "Dia da Justiça" },
  TRT18: { "2026-02-16": "Carnaval", "2026-02-17": "Carnaval", "2026-02-18": "Quarta-feira de Cinzas (expediente suspenso)", "2026-04-01": "Semana Santa", "2026-04-02": "Semana Santa", "2026-04-03": "Semana Santa", "2026-04-20": "Expediente suspenso", "2026-06-04": "Corpus Christi", "2026-06-05": "Expediente suspenso", "2026-08-10": "Expediente suspenso", "2026-08-11": "Dia do Magistrado e do Advogado", "2026-12-07": "Expediente suspenso", "2026-12-08": "Dia da Justiça" },
  STJ: { "2026-02-16": "Carnaval", "2026-02-17": "Carnaval", "2026-04-01": "Semana Santa", "2026-04-02": "Semana Santa", "2026-04-03": "Semana Santa", "2026-04-20": "Sem expediente", "2026-06-04": "Corpus Christi", "2026-06-05": "Sem expediente", "2026-08-10": "Sem expediente", "2026-08-11": "Feriado (Lei 5.010/66)", "2026-10-30": "Dia do Servidor (transferido)", "2026-12-07": "Sem expediente", "2026-12-08": "Feriado (Lei 5.010/66)" },
  TST: { "2026-02-16": "Carnaval", "2026-02-17": "Carnaval", "2026-04-01": "Semana Santa", "2026-04-02": "Semana Santa", "2026-04-03": "Semana Santa", "2026-04-20": "Ponto facultativo", "2026-06-04": "Corpus Christi", "2026-06-05": "Ponto facultativo", "2026-08-10": "Ponto facultativo", "2026-08-11": "Feriado (Lei 5.010/66)", "2026-10-30": "Dia do Servidor (transferido)", "2026-12-07": "Ponto facultativo", "2026-12-08": "Feriado (Lei 5.010/66)" },
  TJMG: { "2026-02-16": "Carnaval", "2026-02-17": "Carnaval", "2026-02-18": "Carnaval", "2026-04-01": "Semana Santa", "2026-04-02": "Semana Santa", "2026-04-03": "Semana Santa", "2026-04-20": "Expediente suspenso", "2026-10-30": "Dia do Servidor Público", "2026-12-07": "Expediente suspenso" },
};
const CAL_MUNICIPAIS: Record<string, { nome: string; fixos: Record<string, string> }> = { itumbiara: { nome: "Itumbiara", fixos: { "05-22": "Santa Rita de Cássia (padroeira de Itumbiara)", "10-12": "Aniversário de Itumbiara" } } };
const UF_TJ: Record<string, string> = { "01": "AC", "02": "AL", "03": "AP", "04": "AM", "05": "BA", "06": "CE", "07": "DF", "08": "ES", "09": "GO", "10": "MA", "11": "MT", "12": "MS", "13": "MG", "14": "PA", "15": "PB", "16": "PR", "17": "PE", "18": "PI", "19": "RJ", "20": "RN", "21": "RS", "22": "RO", "23": "RR", "24": "SC", "25": "SE", "26": "SP", "27": "TO" };
function tribPorNumero(num: unknown): string { const d = soDigitos(num); if (d.length !== 20) return ""; const j = d[13], tr = d.slice(14, 16); if (j === "8") return UF_TJ[tr] ? "TJ" + UF_TJ[tr] : ""; if (j === "5") return tr === "00" ? "TST" : "TRT" + +tr; if (j === "4") return "TRF" + +tr; if (j === "3") return "STJ"; if (j === "1") return "STF"; return ""; }
const normTrib = (t: unknown) => { const x = String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); return x === "TRTGO" ? "TRT18" : x; };
function comarcaDe(orgao: unknown, cid: unknown): string { const t = normTxt([orgao, cid].join(" ")); let r = ""; Object.keys(CAL_MUNICIPAIS).forEach((k) => { if (t.includes(k)) r = k; }); return r; }
type Ctx = { trib: string; comarca: string };
const ctxPrazo = (o: Obj): Ctx => ({ trib: normTrib(o.portal) || tribPorNumero(o.num), comarca: comarcaDe(o.orgao, o.cid) });
function pascoa(y: number): Date {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, mes - 1, dia));
}
const desl = (dt: Date, n: number) => { const x = new Date(dt.getTime()); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const ferCache: Record<string, Record<string, string>> = {};
function feriadosTrib(y: number, ctx: Ctx): Record<string, string> {
  const key = y + "|" + ctx.trib + "|" + ctx.comarca;
  if (ferCache[key]) return ferCache[key];
  const f: Record<string, string> = {};
  [["01-01", "Confraternização Universal"], ["04-21", "Tiradentes"], ["05-01", "Dia do Trabalho"], ["09-07", "Independência"], ["10-12", "Nossa Senhora Aparecida"], ["11-02", "Finados"], ["11-15", "Proclamação da República"], ["11-20", "Consciência Negra"], ["12-25", "Natal"]].forEach((x) => (f[y + "-" + x[0]] = x[1]));
  const p = pascoa(y); f[desl(p, -2)] = "Sexta-feira Santa";
  if (/^TRT|^TRF|^TST|^STJ$/.test(ctx.trib)) {
    f[desl(p, -48)] = "Carnaval (Lei 5.010/66)"; f[desl(p, -47)] = "Carnaval (Lei 5.010/66)";
    for (let d = -4; d <= 0; d++) f[desl(p, d)] = "Semana Santa (Lei 5.010/66)";
    f[y + "-08-11"] = "Dia do Advogado (Lei 5.010/66)"; f[y + "-11-01"] = "Todos os Santos (Lei 5.010/66)"; f[y + "-12-08"] = "Dia da Justiça (Lei 5.010/66)";
  }
  if (ctx.trib === "TJGO") { f[y + "-10-28"] = "Dia do Servidor Público (estadual)"; f[y + "-12-08"] = "Dia da Justiça"; }
  if (y === 2026 && CAL_2026[ctx.trib]) Object.assign(f, CAL_2026[ctx.trib]);
  if (ctx.comarca && CAL_MUNICIPAIS[ctx.comarca]) { const fx = CAL_MUNICIPAIS[ctx.comarca].fixos; Object.keys(fx).forEach((md) => { if (!f[y + "-" + md]) f[y + "-" + md] = fx[md]; }); }
  ((CFG && CFG.feriados) || []).forEach((c: Obj) => {
    if (!c.data || (+String(c.data).slice(0, 4) !== y && !c.anual)) return;
    if (c.trib && c.trib !== "TODOS" && c.trib !== ctx.trib) return;
    const cc = normTxt(c.comarca);
    if (cc && cc !== ctx.comarca && !cc.includes(ctx.comarca || "#") && !ctx.comarca.includes(cc)) return;
    f[c.anual ? y + String(c.data).slice(4) : c.data] = c.desc || "Sem expediente";
  });
  return (ferCache[key] = f);
}
function suspensao(iso: string, ctx: Ctx): string {
  const md = iso.slice(5);
  if (md >= "12-20" || md <= "01-20") return "Suspensão de prazos (CPC, art. 220)";
  if (/^(STJ|STF|TST)$/.test(ctx.trib) && (md <= "01-31" || (md >= "07-02" && md <= "07-31"))) return "Férias coletivas — prazos suspensos";
  return "";
}
function diaUtilForense(iso: string, ctx: Ctx): boolean { const w = new Date(iso + "T12:00:00Z").getUTCDay(); return w !== 0 && w !== 6 && !feriadosTrib(+iso.slice(0, 4), ctx)[iso]; }
const diaContavel = (iso: string, ctx: Ctx) => diaUtilForense(iso, ctx) && !suspensao(iso, ctx);
function motivo(iso: string, ctx: Ctx): string { const w = new Date(iso + "T12:00:00Z").getUTCDay(); if (w === 0 || w === 6) return "fim de semana"; return feriadosTrib(+iso.slice(0, 4), ctx)[iso] || suspensao(iso, ctx) || ""; }
function proxDiaUtil(iso: string, ctx: Ctx): string { let x = somaDias(iso, 1); while (!diaUtilForense(x, ctx)) x = somaDias(x, 1); return x; }
function somaDiasUteis(pub: string, n: number, ctx: Ctx): string { let x = pub, c = 0; while (c < n) { x = somaDias(x, 1); if (diaContavel(x, ctx)) c++; } return x; }
const diasEntre = (a: string, b: string) => Math.round((new Date(b + "T12:00:00Z").getTime() - new Date(a + "T12:00:00Z").getTime()) / 864e5);
const fmtBR = (iso: string) => iso.slice(8, 10) + "/" + iso.slice(5, 7);
function diasPulados(pub: string, lim: string, ctx: Ctx): string[] {
  const g: { ini: string; fim: string; m: string }[] = []; let x = pub;
  while (x < lim) { x = somaDias(x, 1); const m = motivo(x, ctx); if (!m || m === "fim de semana") continue; const u = g[g.length - 1]; if (u && u.m === m && diasEntre(u.fim, x) <= 3) u.fim = x; else g.push({ ini: x, fim: x, m }); }
  return g.map((z) => (z.ini === z.fim ? fmtBR(z.ini) : fmtBR(z.ini) + " a " + fmtBR(z.fim)) + " (" + z.m + ")");
}
const NUM_EXT: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, sessenta: 60, noventa: 90 };
function prazoDoTexto(t: string): number {
  const x = normTxt(t);
  const m = x.match(/prazo[^.;:]{0,60}?(\d{1,3})\s*(?:\([^)]{0,30}\)\s*)?(dias?|horas?)\b/) || x.match(/prazo[^.;:]{0,60}?\(\s*(\d{1,3})\s*\)\s*(dias?|horas?)\b/);
  if (m) { let n = +m[1]; if (m[2].startsWith("hora")) n = Math.max(1, Math.ceil(n / 24)); if (n > 0 && n <= 120) return n; }
  const w = x.match(/prazo[^.;:]{0,60}?\b(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|sessenta|noventa)\b(?:\s+e\s+(um|dois|tres|quatro|cinco|seis|sete|oito|nove))?\s*(?:\([^)]{0,10}\)\s*)?dias?\b/);
  if (w) return NUM_EXT[w[1]] + (w[2] ? NUM_EXT[w[2]] : 0);
  return 0;
}
function regraPrazo(info: Obj): { dias: number; tipo: string; regra: string } {
  const t = normTxt([info.tipoCom, info.teor].join(" ")), orgao = normTxt(info.orgao), trib = String(info.portal || "").toUpperCase();
  const trab = /^TRT|^TST/.test(trib), jec = /juizado/.test(orgao) || /juizado especial/.test(t.slice(0, 600));
  const n = prazoDoTexto(info.teor);
  if (n) return { dias: n, tipo: "manifestacao", regra: `Prazo indicado no texto da publicação: ${n} dia(s) úteis.` };
  if (/sentenca|julgo (?:totalmente |parcialmente )?(?:im)?procedente/.test(t)) {
    if (trab) return { dias: 8, tipo: "recurso", regra: "Sentença trabalhista: recurso ordinário em 8 dias úteis (CLT, art. 895, I)." };
    if (jec) return { dias: 10, tipo: "recurso", regra: "Sentença no Juizado: recurso inominado em 10 dias úteis (Lei 9.099/95, art. 42)." };
    return { dias: 15, tipo: "recurso", regra: "Sentença: apelação em 15 dias úteis (CPC, art. 1.003, § 5º)." };
  }
  if (/acordao/.test(t)) {
    if (trab) return { dias: 8, tipo: "recurso", regra: "Acórdão trabalhista: recurso em 8 dias úteis (CLT, art. 896 / Lei 5.584/70). Embargos de declaração: 5 dias." };
    return { dias: 15, tipo: "recurso", regra: "Acórdão: recurso especial/extraordinário em 15 dias úteis (CPC, art. 1.003, § 5º). Embargos de declaração: 5 dias." };
  }
  if (/\bcitacao\b|\bcite-se\b/.test(t)) return { dias: 15, tipo: "contestacao", regra: "Citação: contestação em 15 dias úteis (CPC, art. 335). Confira se há audiência designada." };
  return { dias: 5, tipo: "manifestacao", regra: "Sem prazo expresso no texto: 5 dias úteis (CPC, art. 218, § 3º)." };
}
function calcPrazo(dataDisp: string, info: Obj) {
  if (!dataDisp) return null;
  const ctx = ctxPrazo(info), pub = proxDiaUtil(dataDisp, ctx), r = regraPrazo(info), lim = somaDiasUteis(pub, r.dias, ctx), pul = diasPulados(pub, lim, ctx);
  const regra = r.regra + (ctx.trib ? " Calendário: " + ctx.trib + (ctx.comarca ? " / " + CAL_MUNICIPAIS[ctx.comarca].nome : "") + "." : "") + (pul.length ? " Dias não contados: " + pul.slice(0, 6).join(", ") + (pul.length > 6 ? "…" : "") + "." : "");
  return { dataPub: pub, limite: lim, dias: r.dias, tipo: r.tipo, regra };
}

// ---------- LIGAÇÃO COM CLIENTES ----------
function cliPorPartes(nomes: string[], clientes: Obj[]): Obj | null {
  const achados: Record<string, Obj> = {};
  nomes.forEach((n) => {
    const pn = normTxt(n); if (!pn) return;
    clientes.forEach((c) => {
      const cn = normTxt(c.nome); if (!cn) return;
      const pal = cn.split(/\s+/).filter((w) => w.length > 2);
      if (cn === pn || (pal.length >= 2 && pal.every((w) => (" " + pn + " ").includes(" " + w + " ")))) achados[c.id] = c;
    });
  });
  const l = Object.values(achados);
  return l.length === 1 ? l[0] : null;
}
function areaPorTribunal(sig: string, orgao: string): string {
  const s = String(sig || "").toUpperCase(), o = normTxt(orgao);
  if (/^TRT|^TST/.test(s)) return "Trabalhista";
  if (/previdenc|federal/.test(o) && /^TRF/.test(s)) return "Previdenciário";
  if (/familia/.test(o)) return "Família";
  if (/criminal/.test(o)) return "Criminal";
  return "Cível";
}
function ufPorTribunal(sig: string): string {
  const s = String(sig || "").toUpperCase();
  let m = s.match(/^TJ([A-Z]{2})$/); if (m) return m[1];
  const trt: Record<string, string> = { "1": "RJ", "2": "SP", "3": "MG", "4": "RS", "5": "BA", "6": "PE", "7": "CE", "8": "PA", "9": "PR", "10": "DF", "11": "AM", "12": "SC", "13": "PB", "14": "RO", "15": "SP", "16": "MA", "17": "ES", "18": "GO", "19": "AL", "20": "SE", "21": "RN", "22": "PI", "23": "MT", "24": "MS" };
  m = s.match(/^TRT(\d{1,2})$/); return m ? trt[m[1]] || "" : "";
}

async function buscarOab(o: { n: string; uf: string }, ini: string, fim: string): Promise<Obj[]> {
  const itens: Obj[] = [];
  for (let pagina = 1; pagina <= 20; pagina++) {
    const q = new URLSearchParams({
      numeroOab: o.n, ufOab: o.uf,
      dataDisponibilizacaoInicio: ini, dataDisponibilizacaoFim: fim,
      itensPorPagina: "100", pagina: String(pagina),
    });
    const r = await fetch(`${API}?${q}`, { headers: { Accept: "application/json" } });
    if (r.status === 429) { await espera(60000); pagina--; continue; }
    if (!r.ok) throw new Error(`DJEN respondeu ${r.status} para OAB ${o.n}/${o.uf}`);
    const js = await r.json();
    const lote: Obj[] = js?.items ?? [];
    itens.push(...lote);
    if (lote.length < 100) break;
    await espera(600);
  }
  return itens;
}

// ---------- gravação com controle de versão (mesma lógica do sistema) ----------
const idDe = (x: unknown): string | null => (x && typeof x === "object" && (x as Obj).id != null ? String((x as Obj).id) : null);
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function mesclar(base: any, local: any, remoto: any): any {
  const ehObj = (x: any) => x && typeof x === "object" && !Array.isArray(x);
  const escolhe = (b: any, l: any, r: any): any => {
    const lM = !igual(l, b), rM = !igual(r, b);
    if (lM && rM && !igual(l, r) && ehObj(l) && ehObj(r) && ehObj(b)) { // mesmo registro alterado pelos dois: junta campo a campo
      const o: Obj = {};
      new Set([...Object.keys(r), ...Object.keys(l), ...Object.keys(b)]).forEach((c) => { const v = escolhe(b[c], l[c], r[c]); if (v !== undefined) o[c] = v; });
      return o;
    }
    return lM ? l : r;
  };
  if (Array.isArray(local) && Array.isArray(remoto)) {
    const bs: any[] = Array.isArray(base) ? base : [];
    if ([...local, ...remoto, ...bs].some((x) => idDe(x) === null)) return escolhe(bs, local, remoto);
    const B: Obj = {}, L: Obj = {};
    bs.forEach((x) => (B[idDe(x)!] = x)); local.forEach((x) => (L[idDe(x)!] = x));
    const out: any[] = [], pos: Record<string, 1> = {}, feito: Record<string, 1> = {};
    remoto.forEach((x) => { const id = idDe(x)!; if (feito[id]) return; feito[id] = 1; const v = escolhe(B[id], L[id], x); if (v !== undefined) { pos[id] = 1; out.push(v); } });
    let ant: string | null = null, frente = 0;
    local.forEach((x) => {
      const id = idDe(x)!;
      if (!feito[id]) {
        feito[id] = 1; const v = escolhe(B[id], x, undefined);
        if (v !== undefined) { const at = ant === null ? -1 : out.findIndex((o) => idDe(o) === ant); if (at >= 0) out.splice(at + 1, 0, v); else out.splice(frente++, 0, v); pos[id] = 1; }
      }
      if (pos[id]) ant = id;
    });
    return out;
  }
  if (local && remoto && typeof local === "object" && typeof remoto === "object") {
    const b: Obj = base && typeof base === "object" && !Array.isArray(base) ? base : {}, o: Obj = {};
    new Set([...Object.keys(remoto), ...Object.keys(local), ...Object.keys(b)]).forEach((c) => { const v = escolhe(b[c], local[c], remoto[c]); if (v !== undefined) o[c] = v; });
    return o;
  }
  return escolhe(base, local, remoto);
}

Deno.serve(async (req: Request) => {
  if (!SENHA_AGENDAMENTO || req.headers.get("x-cron-secret") !== SENHA_AGENDAMENTO) {
    return new Response("Não autorizado", { status: 401 });
  }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const agora = new Date().toISOString();
  const log = async (dados: Obj) =>
    await sb.from("crm_store").upsert({ key: "djen_log", data: { em: agora, ...dados }, updated_at: agora, updated_by: "robô DJEN" });

  try {
    const fim = hojeBrasil();
    const ini = somaDias(fim, -DIAS_ATRAS);

    const achados: Record<string, Obj> = {};
    for (const o of OABS) {
      for (const it of await buscarOab(o, ini, fim)) {
        const k = String(it.id ?? it.hash ?? "");
        if (k && !achados[k]) achados[k] = it;
      }
      await espera(600);
    }

    // lê o estado atual logo antes de gravar
    const { data: rows, error } = await sb.from("crm_store").select("key,data,updated_at").in("key", ["jur_i", "jur_p", "jur_pz", "jur_cli", "jur_a", "jur_cfg"]);
    if (error) throw error;
    const fotoInicial: Obj[] = JSON.parse(JSON.stringify(rows ?? [])); // cópia intacta: o robô altera os objetos lidos
    const pega = (k: string): Obj[] => (rows?.find((r: Obj) => r.key === k)?.data as Obj[]) ?? [];
    const intims = pega("jur_i"), procs = pega("jur_p"), prazos = pega("jur_pz"), clientes = pega("jur_cli"), ands = pega("jur_a");
    const cfgRow = rows?.find((r: Obj) => r.key === "jur_cfg")?.data; CFG = cfgRow && !Array.isArray(cfgRow) ? cfgRow : {};
    const existentes = new Set(intims.map((x) => x.djenId).filter(Boolean));

    const novas: Obj[] = [], novosProcs: Obj[] = [], novosPrazos: Obj[] = [];
    for (const [k, it] of Object.entries(achados)) {
      if (existentes.has(k)) continue;
      const num = it.numeroprocessocommascara || it.numero_processo || "";
      const data = String(it.data_disponibilizacao || it.datadisponibilizacao || "").slice(0, 10);
      const teor = htmlParaTexto(it.texto);
      const tipoCom = [it.tipoComunicacao, it.tipoDocumento].filter(Boolean).join(" · ");
      const partesL: string[] = (it.destinatarios ?? []).map((d: Obj) => d.nome).filter(Boolean);
      const advs: Obj[] = (it.destinatarioadvogados ?? []).map((x: Obj) => x.advogado).filter(Boolean);
      const meu = advs.find((a) => OABS.some((o) => String(a.numero_oab) === o.n && String(a.uf_oab).toUpperCase() === o.uf));

      let proc = [...novosProcs, ...procs].find((p) => p.num && soDigitos(p.num) === soDigitos(num));
      let cli: Obj | null = proc ? clientes.find((c) => c.id === proc!.cliId) ?? clientes.find((c) => c.nome === proc!.cli) ?? null : cliPorPartes(partesL, clientes);
      if (!proc && cli && num) {
        proc = {
          id: uid(), cliId: cli.id, cli: cli.nome, num, area: areaPorTribunal(it.siglaTribunal, it.nomeOrgao), st: "Ativo",
          resp: meu?.nome ?? "", cid: "", uf: ufPorTribunal(it.siglaTribunal), ab: "", pz: "", val: 0, lnk: "",
          obs: `Cadastrado automaticamente a partir de publicação do DJEN (${it.siglaTribunal ?? ""}${it.nomeOrgao ? " — " + it.nomeOrgao : ""}). Revise área e dados.`,
          origem: "DJEN",
        };
        novosProcs.push(proc);
      }
      const z = calcPrazo(data, { teor, tipoCom, portal: it.siglaTribunal, orgao: it.nomeOrgao, num, cid: proc?.cid });
      const intim: Obj = {
        id: uid(), procId: proc?.id ?? "", cliId: cli?.id ?? "", numProc: num,
        teor: teor || "(sem texto — abra o inteiro teor)", data, dataPub: z?.dataPub ?? "",
        pz: z?.limite ?? "", pzAuto: !!z, pzDias: z?.dias ?? 0, pzTipo: z?.tipo ?? "", pzRegra: z?.regra ?? "",
        resp: meu?.nome ?? "", portal: it.siglaTribunal ?? "", orgao: it.nomeOrgao ?? "", tipoCom,
        link: it.link ?? "", partes: partesL.join(", "), djenId: k, st: "pendente", origem: "DJEN",
      };
      novas.push(intim);
      if (z) {
        novosPrazos.push({
          id: uid(), procId: intim.procId, desc: (tipoCom ? tipoCom + " — " : "") + "publicação DJEN" + (num && !intim.procId ? ` (${num})` : ""),
          tipo: z.tipo, resp: intim.resp, pub: z.dataPub, limite: z.limite, alerta: 3,
          obs: `Prazo estimado automaticamente. ${z.regra} Confira no inteiro teor.`, cumprido: false,
          intimId: intim.id, origem: "DJEN", estimado: true,
        });
      }
    }

    // ---------- ANDAMENTOS PELO DATAJUD (até 40 processos por execução, os mais antigos primeiro) ----------
    const todosProcs = [...novosProcs, ...procs];
    const ja = new Set(ands.map((a) => a.djKey).filter(Boolean));
    const novosAnds: Obj[] = [];
    let djConsultados = 0, djErro = "";
    const ativos = todosProcs
      .filter((p) => p.st !== "Arquivado" && p.st !== "Concluído" && tribPorNumero(p.num))
      .sort((a, b) => String(a.djAtualizadoEm || "").localeCompare(String(b.djAtualizadoEm || "")))
      .slice(0, 40);
    for (const p of ativos) {
      try {
        const alias = tribPorNumero(p.num).toLowerCase();
        const r = await fetch(`https://api-publica.datajud.cnj.jus.br/api_publica_${alias}/_search`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: CFG.datajudChave || DATAJUD_CHAVE },
          body: JSON.stringify({ query: { match: { numeroProcesso: soDigitos(p.num) } }, size: 10 }),
        });
        djConsultados++;
        if (!r.ok) { djErro = `DataJud respondeu ${r.status}`; if (r.status === 401 || r.status === 403) break; continue; }
        const js = await r.json();
        const hits: Obj[] = js?.hits?.hits ?? [];
        hits.forEach((h) => {
          const src = h._source || {};
          if (src.classe?.nome) p.djClasse = src.classe.nome;
          if (src.orgaoJulgador?.nome) p.djOrgao = src.orgaoJulgador.nome;
          (src.movimentos || []).forEach((m: Obj) => {
            if (!m?.dataHora) return;
            const k = p.id + "|" + (m.codigo || m.nome) + "|" + m.dataHora;
            if (ja.has(k)) return; ja.add(k);
            const comp = (m.complementosTabelados || []).map((c: Obj) => c.nome || c.descricao || c.valor).filter(Boolean).join("; ");
            novosAnds.push({ id: uid(), procId: p.id, data: String(m.dataHora).slice(0, 10), hora: String(m.dataHora).slice(11, 16), tipo: "DataJud", desc: m.nome + (comp ? " — " + comp : ""), djKey: k, grau: src.grau || "", origem: "DataJud" });
          });
        });
        p.djAtualizadoEm = new Date().toISOString();
      } catch (e) { djErro = String((e as Error)?.message ?? e); }
      await espera(700);
    }

    // grava só o que o robô mudou; se alguém do escritório alterou a lista durante a execução, junta item por item
    const lido = (k: string) => fotoInicial.find((r: Obj) => r.key === k);
    const gravar = async (k: string, dados: unknown, autor: string) => {
      let base: unknown = lido(k)?.data ?? [], ts: string | null = lido(k)?.updated_at ?? null, local: unknown = dados;
      for (let t = 0; t < 6; t++) {
        const { data: r, error: e2 } = await sb.rpc("crm_gravar", { p_key: k, p_data: local, p_esperado: ts, p_autor: autor });
        if (e2) throw e2;
        if ((r as Obj)?.ok) return;
        const remoto = (r as Obj)?.data ?? [];
        local = mesclar(base, local, remoto); base = remoto; ts = (r as Obj)?.updated_at ?? null;
      }
      throw new Error("Conflito persistente ao gravar " + k);
    };
    if (novas.length) {
      await gravar("jur_i", [...novas, ...intims], "robô DJEN");
      await gravar("jur_pz", [...novosPrazos, ...prazos], "robô DJEN");
    }
    if (novosProcs.length || djConsultados) await gravar("jur_p", todosProcs, "robô DJEN");
    if (novosAnds.length) await gravar("jur_a", [...ands, ...novosAnds], "robô DataJud");
    const resumo = { novas: novas.length, processosCriados: novosProcs.length, prazos: novosPrazos.length, encontradas: Object.keys(achados).length, periodo: [ini, fim], andamentosNovos: novosAnds.length, processosConsultadosDataJud: djConsultados, ...(djErro ? { avisoDataJud: djErro } : {}) };
    await log(resumo);
    return Response.json({ ok: true, ...resumo });
  } catch (e) {
    await log({ erro: String((e as Error)?.message ?? e) });
    return Response.json({ ok: false, erro: String(e) }, { status: 500 });
  }
});
