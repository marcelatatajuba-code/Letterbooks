/* ============================================================================
   config.js — a chave da nuvem.

   Enquanto as duas linhas abaixo estiverem vazias, o Letterbooks funciona
   exatamente como hoje: tudo no proprio aparelho, sem conta, sem servidor.
   Nada quebra.

   Para ligar a rede social (contas, feed, seguir, curtir, comentar), siga o
   servidor/LEIA-ME.md e cole aqui os dois valores que o Supabase te da em
   Project Settings -> API. Os dois sao PUBLICOS por natureza: a chave "anon"
   nasce para ficar no navegador de quem visita. Quem protege os dados sao as
   politicas de RLS do servidor/esquema.sql, nao o segredo desta chave.
   ========================================================================== */
var CONFIG = {
  supabaseUrl: 'https://ifnnsttcpawcyyvypczn.supabase.co',
  supabaseChave: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlmbm5zdHRjcGF3Y3l5dnlwY3puIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwNTU2ODIsImV4cCI6MjEwMzYzMTY4Mn0.hthoNs1Ha1HyY1YdXPPqGEIqtbBmWG74VUbmIqkcLJI'
};
