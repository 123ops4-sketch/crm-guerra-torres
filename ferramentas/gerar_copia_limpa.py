#!/usr/bin/env python3
"""Gera uma cópia do CRM sem dados, contas e identidade de Guerra & Torres.

Uso:  python3 ferramentas/gerar_copia_limpa.py site/index.html saida/index.html

A cópia abre em modo local (sem nuvem); quem a recebe pode ligar o próprio
Supabase e a própria conta Google em Configurações. Os dados do escritório
(nome, advogado, OAB, endereço) são preenchidos em Configurações › Escritório
e passam a sair nas procurações, contratos e relatórios.
"""
import re, sys

src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf-8').read()

def rep(a, b, n=1):
    global s
    c = s.count(a)
    if c != n:
        sys.exit(f'Trecho esperado {n}x, encontrado {c}x: {a[:90]!r}')
    s = s.replace(a, b)

def rep_re(pat, b, n=1):
    global s
    s, c = re.subn(pat, lambda m: b, s)
    if c != n:
        sys.exit(f'Padrão esperado {n}x, encontrado {c}x: {pat[:90]!r}')

# --- identidade visual ---
rep('<title>Guerra & Torres Advocacia</title>', '<title>CRM Jurídico</title>')
rep('<h1>Guerra &amp; Torres</h1>', '<h1>CRM Jurídico</h1>')
rep('<span>Guerra & Torres</span>', '<span>CRM Jurídico</span>')

# --- nuvem e contas ---
rep_re(r"var SB_URL_FIXA='[^']*', SB_KEY_FIXA='[^']*';", "var SB_URL_FIXA='', SB_KEY_FIXA='';")
rep("var GOOGLE_CONTA_PADRAO='guerraetorresadvocacia@gmail.com';", "var GOOGLE_CONTA_PADRAO='';")
rep("'53087/GO, 72570/GO'", "''", 2)
rep('placeholder="53087/GO, 72570/GO"', 'placeholder="00000/UF, 00000/UF"')
rep("'Informe ao menos uma OAB no formato 53087/GO.'", "'Informe ao menos uma OAB no formato 00000/UF.'")

# --- dados do escritório: tudo vem de Configurações › Escritório ---
i = s.index('function escritorio(){'); j = s.index('\n}', i) + 2
s = s[:i] + """function escritorio(){
  var e=(cfg&&cfg.escritorio)||{};
  return{nome:e.nome||'Meu Escritório de Advocacia',advogado:e.advogado||'',oab:e.oab||'',
    endereco:e.endereco||'',cidade:e.cidade||'',telefone:e.telefone||'',email:e.email||'',
    pix:e.pix||'',cnpj:e.cnpj||''};
}
function gtAdvs(){var e=escritorio();return(e.advogado||'[NOME DO ADVOGADO]')+', '+(e.oab||'OAB/[UF] nº [NÚMERO]')}
function gtQualAdv(){var e=escritorio();return(e.advogado||'[NOME DO ADVOGADO]').toUpperCase()+', advogado(a), inscrito(a) na '+(e.oab||'OAB/[UF] nº [NÚMERO]')+', com endereço profissional na '+(e.endereco||'[ENDEREÇO PROFISSIONAL]')}
""" + s[j:]
rep_re(r"var GT_OUTORGADOS='[^']*';", "")
rep_re(r"var GT_CONTRATADO='[^']*';", "")
s = s.replace('GT_OUTORGADOS', "(gtQualAdv()+', com os poderes adiante mencionados.')").replace('GT_CONTRATADO', "(gtQualAdv()+'.')")
rep_re(r"var GT_HONORARIOS_DEFAULT='[^']*';", "var GT_HONORARIOS_DEFAULT='A remuneração pelos serviços prestados obedecerá às seguintes condições:\\n[DESCREVA AQUI OS HONORÁRIOS: valores ou percentuais, fases e forma de pagamento].';")
rep('Paulo Henrique Braga Torres, OAB/GO 53.087, e Allane Ferreira Guerra, OAB/GO 72.570', "'+gtAdvs()+'", 2)
rep("var cidade=c.cid||'Itumbiara';", "var cidade=c.cid||escritorio().cidade||'[CIDADE]';")
rep("\\nGuerra & Torres Advocacia\\nCONTRATADO'", "\\n'+escritorio().nome+'\\nCONTRATADO'")
rep('<div class="footer">Guerra & Torres Advocacia</div>', '<div class="footer">\'+esc(escritorio().nome)+\'</div>', 2)
rep('<div class="logo">GT</div><div class="firm">Guerra & Torres<small>Advocacia</small></div>',
    '<div class="logo">\'+esc(escritorio().nome.split(/\\s+/).filter(function(w){return w.length>2}).slice(0,2).map(function(w){return w[0]}).join(\'\').toUpperCase())+\'</div><div class="firm">\'+esc(escritorio().nome)+\'</div>')
rep('<div class="footer">Guerra & Torres Advocacia — Relatório confidencial</div>', '<div class="footer">\'+esc(escritorio().nome)+\' — Relatório confidencial</div>')
rep("O escritório *Guerra & Torres Advocacia* deseja", "O escritório *'+escritorio().nome+'* deseja")
rep("Abraços,\\n*Guerra & Torres Advocacia*'", "Abraços,\\n*'+escritorio().nome+'*'")
rep("Goiânia, {{DATA}}.\\n\\nGuerra & Torres Advocacia", "[CIDADE], {{DATA}}.\\n\\n[NOME DO ESCRITÓRIO]")
rep("Advogados do escritório Guerra & Torres Advocacia.", "Advogados do escritório [NOME DO ESCRITÓRIO].")
rep("l=[e.advogado||'Paulo Henrique Braga Torres','Allane Ferreira Guerra']", "l=[e.advogado]")
rep('variações como "Dr. Paulo" ou "Allane"', 'variações como "Dr. Fulano" ou só o primeiro nome')
rep('para você e a Dra. Allane', 'para toda a equipe')
rep("PRODID:-//Guerra e Torres//Agenda Juridica//PT", "PRODID:-//CRM Juridico//Agenda//PT")
rep("'@guerraetorres'", "'@crmjuridico'")
rep('(ex.: "Agenda Guerra Torres")', '(ex.: "Agenda do escritório")')
rep('https://crm-guerra-torres.vercel.app', 'https://seu-escritorio.vercel.app')

# --- comentários ---
rep('// "Dr. Paulo", "paulo henrique", "Paulo H. B. Torres" → "Paulo Henrique Braga Torres"', '// "Dr. Fulano", "fulano de tal" → nome completo cadastrado na equipe')
rep('(modelo padrão Guerra & Torres)', '(modelo padrão)')

# --- a peça-modelo do escritório não vai junto ---
rep('function seedMinutaPadrao(){', 'function seedMinutaPadrao(){return;')

# --- conferência final: nada do escritório pode sobrar ---
proibidos = ['eyehelxgnkueskripfvo', 'sb_publishable_', 'guerraetorresadvocacia', '123ops4', 'advtorresemartins',
             'Allane', 'Paulo Henrique', 'BRAGA TORRES', '53.087', '53087', '72.570', '72570', 'Adejar',
             '5724735', '019.013.571', '9-9999-5572', 'Guerra & Torres', 'Guerra &amp; Torres', 'Larissa']
achados = [p for p in proibidos if p.lower() in s.lower()]
# a peça-modelo continua no código (desativada) — removê-la por inteiro
i = s.index('function seedMinutaPadrao(){return;'); j = s.index('\n}\n', i) + 3
s = s[:i] + 'function seedMinutaPadrao(){}\n' + s[j:]
achados = [p for p in proibidos if p.lower() in s.lower()]
if achados:
    for p in achados:
        k = s.lower().index(p.lower()); print('Sobrou:', p, '→', s[max(0,k-80):k+60].replace('\n',' '))
    sys.exit(1)
open(dst, 'w', encoding='utf-8').write(s)
print('Cópia limpa gerada:', dst, f'({len(s)//1024} KB)')
