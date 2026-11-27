// Ajuda de cada botão: o que ele faz.
// • No computador: pare o mouse em cima do botão.
// • No celular: segure o botão (toque longo) — ou ligue o "❓ Modo ajuda" e toque nos botões:
//   enquanto ele estiver ligado, o toque só explica e não faz nada.
(() => {
  const HELP = {
    // ----- Início -----
    "#mass-open": "Lê a liturgia do dia e monta a Missa inteira: compõe (e, se quiser, grava) um canto para cada momento.",
    '[data-start="catolica"]': "Cria um canto para um momento da Missa (Entrada, Ofertório, Comunhão…), seguindo o tempo litúrgico.",
    '[data-start="livre"]': "Cria uma música de qualquer estilo e tema, com letra e voz.",
    '[data-start="own"]': "Você cola a sua letra (com ou sem acordes) e a IA cria só a música, no seu tom.",
    '[data-view="library"]': "Abre a Biblioteca com todas as suas músicas.",
    // ----- Estúdio (criação) -----
    '[data-mode="catolica"]': "Modo litúrgico: cantos para a Santa Missa, com momentos e tempos litúrgicos.",
    '[data-mode="livre"]': "Modo livre: qualquer estilo de música e qualquer tema.",
    "#ref-clear": "Tira o áudio de referência (a música será criada sem ele).",
    "#ref-yt-go": "Baixa o trecho escolhido do vídeo do YouTube e usa como referência de estilo e sonoridade.",
    "#ref-mic": "Grava você cantando a ideia da melodia (até 45 s); a IA se inspira no seu jeito de cantar.",
    "#bpm-minus": "Deixa a música mais lenta (menos batidas por minuto).",
    "#bpm-plus": "Deixa a música mais rápida (mais batidas por minuto).",
    '[data-s="major"]': "Tom maior: som mais alegre e luminoso.",
    '[data-s="minor"]': "Tom menor: som mais introspectivo e melancólico.",
    "[data-preset]": "Escolhe de uma vez este conjunto de instrumentos.",
    '[data-q="fast"]': "Gravação rápida: fica pronta mais cedo.",
    '[data-q="high"]': "Alta qualidade: mais detalhe no som, demora um pouco mais.",
    "#wz-back": "Volta para a etapa anterior.",
    "#wz-next": "Vai para a próxima etapa.",
    "#btn-lyrics": "A IA compõe a letra com tudo o que você escolheu (revisada, com ortografia conferida).",
    "#btn-own": "Usa a letra que você escreveu ou colou, sem a IA compor.",
    '[data-r="biblica"]': "Reescreve a letra com mais referências e imagens da Bíblia.",
    '[data-r="simples"]': "Deixa a letra mais simples, fácil para a assembleia cantar.",
    '[data-r="poetica"]': "Deixa a letra mais poética, com imagens mais bonitas.",
    '[data-r="rimas"]': "Melhora as rimas sem perder o sentido.",
    '[data-r="metrica"]': "Ajusta o número de sílabas para os versos caberem na mesma melodia.",
    '[data-r="refrao"]': "Cria um refrão novo, mais marcante.",
    '[data-r="estrofe"]': "Acrescenta mais uma estrofe.",
    '[data-r="curta"]': "Encurta a letra (bom para músicas que ficaram longas demais).",
    "#btn-custom-refine": "Aplica na letra o pedido que você escreveu.",
    "[data-sec]": "Acrescenta esta parte (refrão, estrofe, ponte…) na letra.",
    "#btn-regen": "Compõe outra letra diferente, com as mesmas escolhas.",
    "#btn-song": "Grava a música (voz e instrumentos) com esta letra. Ela entra na fila de criação.",
    // ----- Biblioteca -----
    '[data-l="songs"]': "Mostra todas as músicas gravadas.",
    '[data-l="albums"]': "Mostra os álbuns (coleções de músicas).",
    '[data-l="lyrics"]': "Mostra as letras salvas (ainda sem música, ou guardadas para usar depois).",
    "#ly-clear": "Tira os filtros da busca de letras.",
    "#ly-new": "Escreve uma letra nova para guardar em Minhas letras.",
    '[data-f="all"]': "Mostra todas as músicas.",
    '[data-f="liturgia"]': "Mostra só os cantos litúrgicos.",
    '[data-f="fav"]': "Mostra só as favoritas.",
    "#lib-medley": "Junta trechos de 2 a 4 músicas no mesmo tom, com transição suave.",
    "#lib-queue": "Mostra a fila de criação: o que está sendo gravado, com andamento, e o histórico.",
    "[data-fav]": "Marca ou desmarca como favorita.",
    ".fab[data-play]": "Toca esta música.",
    ".alb-new": "Cria um álbum novo.",
    "[data-back]": "Volta para a lista de álbuns.",
    '[data-act="play"]': "Toca tudo em sequência.",
    '[data-act="shuffle"]': "Toca em ordem aleatória.",
    '[data-act="add"]': "Escolhe músicas para colocar aqui.",
    '[data-act="edit"]': "Muda o nome e a descrição.",
    '[data-act="share"]': "Compartilha a lista no WhatsApp.",
    '[data-act="delete"], [data-act="del"]': "Exclui (pede confirmação antes).",
    '[data-act="copy"]': "Copia o texto para colar onde quiser.",
    '[data-act="use"]': "Leva esta letra para o estúdio e cria a música.",
    '[data-act="open"]': "Abre para ver e editar.",
    '[data-op="play"]': "Toca a partir desta música.",
    '[data-op="remove"]': "Tira desta lista (a música continua na biblioteca).",
    // ----- Repertório da Missa -----
    "#sl-new, [data-sl-new]": "Cria um repertório novo: um canto para cada momento da celebração.",
    "#sl-rec-go": "Grava as músicas das letras escolhidas deste repertório.",
    "#sl-rec-cancel": "Cancela a gravação das músicas.",
    "#sl-add": "Acrescenta mais um momento (ex.: Canto de Maria, Envio).",
    "#sl-save": "Salva as mudanças do repertório.",
    "#sl-play": "Toca todos os cantos do repertório, um depois do outro.",
    "#sl-proj": "Mostra as letras em tela cheia para projetar na igreja.",
    "#sl-print": "Monta o folheto com letras e cifras para imprimir ou salvar em PDF.",
    "#sl-wa": "Envia a lista de cantos no WhatsApp.",
    "#sl-del": "Exclui este repertório (as músicas continuam na biblioteca).",
    ".sl-card": "Abre este repertório.",
    '[data-a="rec"]': "Grava a música desta letra.",
    '[data-a="play"]': "Ouve este canto.",
    // ----- Player -----
    "#btn-prev": "Volta para a música anterior.",
    "#btn-play": "Toca ou pausa.",
    "#btn-next": "Vai para a próxima música.",
    "#p-fav": "Marca a música tocando como favorita.",
    "#p-open": "Abre a música que está tocando (letra, cifra, vídeo…).",
    // ----- Janela da música -----
    "#dlg-play": "Toca esta música.",
    "#dlg-fav": "Marca ou desmarca como favorita.",
    "#dlg-reuse": "Leva a letra e as escolhas desta música para o estúdio, para criar uma versão nova.",
    "#dlg-album": "Coloca esta música em um ou mais álbuns.",
    "#dlg-delete": "Exclui esta música e os arquivos dela (pede confirmação).",
    "#dlg-registro": "Gera o registro de autoria da música (texto, prova e página).",
    '[data-t="letra"]': "A letra da música, com tradução e projeção.",
    '[data-t="ficha"]': "Ficha técnica: tudo o que foi escolhido para criar a música.",
    '[data-t="cifra"]': "A cifra (acordes) para violão e teclado, com transposição.",
    '[data-t="editar"]': "Corta, faz fade, muda tom e andamento e cria uma versão editada.",
    '[data-t="faixas"]': "Separa a voz do instrumental (playback) e deixa ouvir cada faixa.",
    '[data-t="karaoke"]': "Cante por cima do playback, grave e junte com a música; treine a afinação.",
    '[data-t="video"]': "Cria um vídeo de 1 minuto para o Status do WhatsApp, Stories e Reels.",
    '[data-t="share"]': "Envia a música, a letra, a cifra, o playback ou o vídeo no WhatsApp.",
    "[data-v]": "Escolhe esta versão da música.",
    "#tr-go": "Traduz a letra para o idioma escolhido, de um jeito que dá para cantar.",
    "#tr-sing": "Grava uma música nova cantada neste idioma (a original continua igual).",
    "#tr-copy": "Copia a tradução.",
    "#proj-song": "Mostra a letra em tela cheia para projetar.",
    "#copy-lyrics": "Copia a letra.",
    "#dlg-save-lyric": "Guarda esta letra em Minhas letras.",
    "#wa-lyrics": "Envia a letra no WhatsApp.",
    "#spec-apply": "Leva todas estas escolhas para o estúdio, para criar outra música igual.",
    "#spec-copy": "Copia a ficha técnica.",
    "#btn-chords": "Gera a cifra: tirada do próprio áudio (quando possível) ou feita pela IA.",
    '[data-i="violao"]': "Mostra os desenhos dos acordes no violão.",
    '[data-i="teclado"]': "Mostra os acordes no teclado.",
    "[data-tr]": "Sobe ou desce a cifra meio tom.",
    "#copy-chords": "Copia a cifra.",
    "#print-chords": "Imprime a cifra ou salva em PDF.",
    "#wa-chords": "Envia a cifra no WhatsApp.",
    "#metro": "Liga o metrônomo no andamento da música.",
    "#ed-preview": "Ouve como vai ficar o trecho escolhido.",
    "#ed-apply": "Cria uma versão nova com os cortes e ajustes (a original continua).",
    "#btn-stems": "Separa a voz do instrumental com IA (leva 1 a 3 min).",
    "#mix-play": "Toca as faixas juntas, com o volume de cada uma.",
    ".m": "Silencia esta faixa.",
    ".s": "Ouve só esta faixa.",
    "#wa-instrumental": "Envia o playback (sem voz) no WhatsApp, para ensaio.",
    "#kk-go-stems": "Separa o playback (sem voz) para você cantar por cima.",
    "#kk-rec": "Começa a gravar você cantando por cima do playback.",
    "#kk-stop": "Para a gravação.",
    '[data-r="igreja"]': "Ambiente de igreja (eco longo) na sua voz.",
    '[data-r="estudio"]': "Ambiente de estúdio (eco curto) na sua voz.",
    '[data-r="seco"]': "Sua voz sem eco.",
    '[data-d=""]': "Só a sua voz com o playback.",
    '[data-d="up"]': "A IA canta uma 2ª voz uma terça acima da melodia, junto com você.",
    '[data-d="down"]': "A IA canta uma 2ª voz uma terça abaixo da melodia, junto com você.",
    "#kk-mix": "Junta a sua voz com o playback, melhora o som e salva como música nova.",
    "#kk-again": "Descarta esta gravação e grava de novo.",
    "#kk-discard": "Apaga a gravação.",
    "#kk-open": "Abre a sua versão na biblioteca.",
    "#kk-del": "Exclui a sua versão da biblioteca.",
    '[data-s="historia"]': "Vídeo em cenas animadas que contam a letra, com a letra discreta embaixo.",
    '[data-s="classico"]': "Vídeo com a capa, o título, o refrão e um equalizador animado.",
    '[data-v="vertical"]': "Formato em pé (9:16): Status, Stories, Reels.",
    '[data-v="horizontal"]': "Formato deitado (16:9): YouTube, Facebook.",
    "#video-listen": "Ouve o começo do trecho de 1 minuto escolhido.",
    "#video-art": "Cria outra imagem ilustrada do tema da música.",
    "#btn-video": "Cria o vídeo de 1 minuto.",
    "#wa-video": "Posta o vídeo no Status ou envia no WhatsApp.",
    "#dl-video": "Baixa o vídeo (MP4).",
    "#sh-audio": "Envia o MP3 da música, com a letra copiada para colar na mensagem.",
    "#sh-lyrics": "Envia só a letra, formatada.",
    "#sh-chords": "Envia a cifra com os acordes alinhados.",
    "#sh-instrumental": "Envia o playback sem voz, para ensaio.",
    "#sh-video": "Envia o vídeo de 1 minuto.",
    // ----- Fila, letras, diálogos -----
    "#qd-pause": "Pausa ou retoma a fila (a música que está gravando termina).",
    "#qd-studio": "Vai para o estúdio criar outra música.",
    "#qd-clear": "Apaga o histórico de músicas já feitas da fila (as músicas continuam na biblioteca).",
    "#lo-save": "Salva as mudanças da letra.",
    "#lo-copy": "Copia a letra.",
    "#lo-music": "Leva esta letra para o estúdio e cria a música.",
    "#lo-del": "Exclui esta letra.",
    "#rd-go": "Grava de novo, aplicando o que você pediu e conferindo a pronúncia.",
    "[data-kind]": "Grava uma versão nova da música neste estilo (a original continua).",
    "#mx-add": "Escolhe as músicas do medley.",
    "#mx-go": "Monta o medley e salva na biblioteca.",
    "#qe-save": "Salva o título e a letra antes de a música ser gravada.",
    "#qe-cancel": "Tira esta música da fila.",
    "#ad-save": "Salva o álbum.",
    "#pk-save": "Salva a escolha.",
    "#pk-new": "Cria um álbum novo.",
    '[data-o="1"]': "Salmo e Aclamação com o texto exato da liturgia do dia.",
    '[data-o="0"]': "Salmo e Aclamação com letra nova criada pela IA, inspirada na liturgia.",
    "#md-go": "Lê a liturgia e monta a Missa (letras e, se marcado, as músicas).",
    "#md-moments": "Marque só os momentos da Missa que você quer criar. O que você desmarca fica guardado para a próxima vez.",
    "#md-mom-all": "Marca todos os momentos da Missa.",
    "#md-mom-none": "Desmarca todos (depois marque só os que quer).",
    "#md-see": "Abre o repertório da Missa montada.",
    "#auto-start": "Liga o estúdio gratuito agora.",
    "#auto-stop": "Desliga o estúdio gratuito.",
    "#kg-save": "Testa e conecta o estúdio de música.",
    "#kg-clear": "Desconecta o estúdio.",
    "#pj-prev": "Volta para a parte anterior da letra.",
    "#pj-next": "Avança para a próxima parte da letra.",
    "#session-hide": "Fecha este aviso e continua usando o app.",
    "#st-play": "Toca ou pausa a música.",
    ".close": "Fecha esta janela.",
    "#help-toggle": "Modo ajuda: enquanto estiver ligado, tocar num botão só mostra o que ele faz.",
  };
  const TEXT = [
    [/ligar est[úu]dio/i, "Liga o estúdio gratuito de música (leva alguns minutos para ficar pronto)."],
    [/desligar est[úu]dio/i, "Desliga o estúdio gratuito (economiza a cota gratuita)."],
    [/^configurar$/i, "Abre as configurações do servidor de música."],
    [/^entrar$/i, "Entra no app com a senha."],
    [/^ouvir$/i, "Ouve esta música."],
    [/^alterar$/i, "Volta para mudar esta escolha."],
    [/abrir o est[úu]dio/i, "Vai para o estúdio de criação."],
  ];

  // dica de cada botão: a explicação fica em data-tip (o title some para não aparecer duas vezes)
  const ALL = Object.keys(HELP).join(",");
  const CLICKABLE = "button, a.btn, [role=button], .chip, .action-card, .share-card";
  const within = (root, sel) => [...(root.matches?.(sel) ? [root] : []), ...root.querySelectorAll(sel)];
  function apply(root = document) {
    if (root !== document && !root.querySelector?.(ALL) && !root.matches?.(ALL) && !root.matches?.(CLICKABLE) && !root.querySelector?.(CLICKABLE)) return;
    for (const [sel, txt] of Object.entries(HELP))
      within(root, sel).forEach((el) => {
        if (!el.dataset.tip && !el.title) el.dataset.tip = txt;
      });
    within(root, CLICKABLE).forEach((el) => {
      if (el.title) {
        el.dataset.tip ||= el.title;
        if (!el.getAttribute("aria-label")) el.setAttribute("aria-label", el.textContent.trim() || el.title);
        el.removeAttribute("title");
      }
      if (!el.dataset.tip) {
        const t = el.textContent.trim();
        const hit = TEXT.find(([re]) => re.test(t));
        if (hit) el.dataset.tip = hit[1];
        else if (el.closest("#genre-chips, .chips")) el.dataset.tip = `Escolhe “${t}”.`;
      }
    });
  }
  let pending = 0;
  const added = new Set();
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) added.add(n);
    if (pending || !added.size) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      const nodes = [...added].filter((n) => n.isConnected);
      added.clear();
      nodes.forEach((n) => apply(n));
    });
  }).observe(document.body, { childList: true, subtree: true });
  apply();

  // ----- balão -----
  const tip = document.createElement("div");
  tip.className = "tipbox";
  tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);
  let shownFor = null, timer = 0;
  // explicação dos botões ligada ou desligada (Ajustes → Ajuda); fica guardado no aparelho
  const tipsOn = () => !document.body.classList.contains("tips-off");
  if (localStorage.getItem("acaia-tips") === "0") document.body.classList.add("tips-off");
  function show(el) {
    const txt = el.dataset.tip;
    if (!txt || !tipsOn()) return;
    // fica dentro da janela aberta (as janelas ficam na camada de cima)
    const host = el.closest("dialog[open]") || document.body;
    if (tip.parentNode !== host) host.appendChild(tip);
    tip.textContent = txt;
    tip.classList.add("on");
    const r = el.getBoundingClientRect();
    const w = Math.min(280, innerWidth - 16);
    tip.style.maxWidth = w + "px";
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2;
    x = Math.max(8, Math.min(innerWidth - tw - 8, x));
    let y = r.top - th - 8;
    if (y < 8) y = r.bottom + 8;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
    shownFor = el;
  }
  function hide() {
    clearTimeout(timer);
    tip.classList.remove("on");
    shownFor = null;
  }
  const target = (e) => e.target.closest?.("[data-tip]");
  // computador: parar o mouse em cima
  document.addEventListener("mouseover", (e) => {
    if (e.pointerType === "touch" || matchMedia("(hover: none)").matches) return;
    const el = target(e);
    if (el === shownFor) return;
    hide();
    if (el) timer = setTimeout(() => show(el), 450);
  });
  document.addEventListener("scroll", hide, true);
  // celular: segurar o botão
  let pressEl = null, longPressed = false;
  document.addEventListener(
    "touchstart",
    (e) => {
      const el = target(e);
      longPressed = false;
      if (!el || !tipsOn()) return hide();
      pressEl = el;
      clearTimeout(timer);
      timer = setTimeout(() => {
        longPressed = true;
        show(el);
        navigator.vibrate?.(15);
      }, 480);
    },
    { passive: true },
  );
  document.addEventListener("touchmove", () => clearTimeout(timer), { passive: true });
  document.addEventListener("touchend", () => clearTimeout(timer), { passive: true });
  document.addEventListener("contextmenu", (e) => longPressed && e.preventDefault());
  // depois do toque longo, o clique não faz a ação (só explicou); no modo ajuda, nenhum toque faz
  document.addEventListener(
    "click",
    (e) => {
      const el = target(e);
      if (longPressed && el === pressEl) {
        e.preventDefault();
        e.stopPropagation();
        longPressed = false;
        return;
      }
      if (document.body.classList.contains("help-mode") && el && el.id !== "help-toggle" && !el.matches(".close, #st-close, [data-close]")) {
        e.preventDefault();
        e.stopPropagation();
        show(el);
        return;
      }
      if (!el) hide();
    },
    true,
  );

  // ----- botão "❓ Modo ajuda" -----
  const btn = document.createElement("button");
  btn.id = "help-toggle";
  btn.className = "help-toggle";
  btn.type = "button";
  btn.textContent = "?";
  btn.dataset.tip = HELP["#help-toggle"];
  btn.setAttribute("aria-label", "Modo ajuda");
  document.body.appendChild(btn);
  btn.addEventListener("click", () => {
    const on = document.body.classList.toggle("help-mode");
    hide();
    btn.setAttribute("aria-pressed", on);
    window.toast?.(on ? "❓ Modo ajuda ligado: toque em qualquer botão para saber o que ele faz. Toque no ? rosa para desligar." : "Modo ajuda desligado.", false, 4500);
  });
  window.setTips = (on) => {
    localStorage.setItem("acaia-tips", on ? "1" : "0");
    document.body.classList.toggle("tips-off", !on);
    if (!on && document.body.classList.contains("help-mode")) btn.click(); // desliga o modo ajuda junto
    hide();
    window.toast?.(on ? "💡 Explicação dos botões ligada." : "Explicação dos botões desligada (ligue de novo em Ajustes → Ajuda).", false, 4000);
  };
  // os diálogos abertos ficam por cima de tudo: o botão de ajuda vai junto
  new MutationObserver(() => {
    const open = [...document.querySelectorAll("dialog[open]")].pop();
    const host = open || document.body;
    if (btn.parentNode !== host) host.appendChild(btn);
  }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ["open"] });
  if (!localStorage.getItem("acaia-help-hint") && tipsOn()) {
    localStorage.setItem("acaia-help-hint", "1");
    setTimeout(() => window.toast?.("💡 Dica: segure qualquer botão (ou pare o mouse em cima) para saber o que ele faz. O botão ? liga o modo ajuda.", false, 7000), 2500);
  }
})();
