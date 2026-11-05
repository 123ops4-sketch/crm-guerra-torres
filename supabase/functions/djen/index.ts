// Supabase Edge Function "djen"
// Painel do Supabase -> Edge Functions -> Deploy a new function -> Via Editor
// Nome da função: djen   |  cole este código  |  Deploy
// Só usuários logados no sistema conseguem chamá-la (verificação de JWT padrão).

const PERMITIDOS = [
  "numeroOab", "ufOab", "dataDisponibilizacaoInicio", "dataDisponibilizacaoFim",
  "pagina", "itensPorPagina", "numeroProcesso", "siglaTribunal",
];
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json();
    const q = new URLSearchParams();
    for (const k of PERMITIDOS) {
      if (body[k] !== undefined && body[k] !== null && body[k] !== "") q.set(k, String(body[k]));
    }
    if (!q.get("numeroOab") && !q.get("numeroProcesso")) {
      return new Response(JSON.stringify({ message: "Informe numeroOab ou numeroProcesso." }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    const r = await fetch("https://comunicaapi.pje.jus.br/api/v1/comunicacao?" + q.toString(), {
      headers: { Accept: "application/json" },
    });
    return new Response(await r.text(), {
      status: r.status, headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ message: String(e) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
