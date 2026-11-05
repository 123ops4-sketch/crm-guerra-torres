// Supabase Edge Function "datajud" — consulta a API pública do DataJud (CNJ) em nome do sistema
// Painel do Supabase -> Edge Functions -> Deploy a new function -> Via Editor
// Nome: datajud  |  cole este código  |  Deploy   (deixe "Verify JWT" LIGADO: só usuários logados usam)

const CHAVE_PADRAO = "APIKey cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(typeof b === "string" ? b : JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { alias, numero, chave } = await req.json();
    if (!/^[a-z0-9]{2,8}$/.test(String(alias || ""))) return json({ message: "Tribunal inválido." }, 400);
    const num = String(numero || "").replace(/\D/g, "");
    if (num.length !== 20) return json({ message: "Número CNJ deve ter 20 dígitos." }, 400);
    const r = await fetch(`https://api-publica.datajud.cnj.jus.br/api_publica_${alias}/_search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: chave || CHAVE_PADRAO },
      body: JSON.stringify({ query: { match: { numeroProcesso: num } }, size: 10 }),
    });
    return json(await r.text(), r.status);
  } catch (e) {
    return json({ message: String((e as Error)?.message ?? e) }, 500);
  }
});
