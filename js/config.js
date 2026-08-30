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
  supabaseUrl: '',
  supabaseChave: ''
};
