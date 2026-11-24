# 🎵 ACAIAMUSIC: estúdio de música com IA

**ACAIA: Arte e Canto, Amor, Inspiração e Adoração.** *Sua fé em forma de canção.*

Estúdio para criar cantos para a Santa Missa e músicas livres:

- **Modo litúrgico**: momento da celebração (Acolhida, Entrada, Aspersão, Kyrie, Glória, Bíblia, Salmo, Aclamação, Ofertório, Santo, Cordeiro, Comunhão, Ação de Graças, Aniversário, Envio, Vela, Maria, Adoração…), tempo litúrgico, leitura base e forma do canto. O Ordinário (Kyrie, Glória, Santo, Cordeiro) usa o **texto oficial do Missal**.
- **Letra por IA** (gratuita) com botões para melhorar, **ou a sua própria letra**, inclusive **com cifra** (a música é criada no tom e na progressão da cifra).
- **Música completa com voz** (30 s a 5 min), com estilo, clima, BPM (com *tap tempo*), tom, instrumentos, vocais e **áudio de referência**.
- **Cifra** gerada por IA, com transposição, impressão e envio.
- **Faixas separadas** (voz, bateria, baixo, instrumentos) e **playback sem voz**, num mixer.
- **Vídeo de 1 minuto para Status** (vertical ou horizontal), com marca d'água ACAIAMUSIC.
- **Compartilhar no WhatsApp**: áudio + letra, cifra, playback e vídeo.

## Como rodar

1. Instale o [Node.js](https://nodejs.org) 20 ou mais novo.
2. Crie o arquivo `.env` a partir do `.env.example` e coloque o `HF_TOKEN` (conta gratuita do Hugging Face).
3. Rode `npm install` e depois `npm start`.
4. Abra http://localhost:3000

## Sem limite diário: seu estúdio no Kaggle (grátis)

Os servidores gratuitos do Hugging Face têm limite diário. Para criar sem esse limite, use a GPU gratuita do Kaggle (30 h por semana):

1. Crie uma conta em kaggle.com e verifique o telefone.
2. No app, abra **⚙️ Servidor** e baixe o notebook (`public/kaggle/acaiamusic-estudio.ipynb`).
3. No Kaggle: **Import Notebook**, depois **Accelerator: GPU T4 x2**, **Internet: On** e **Run All**.
4. Cole no app o **endereço** e a **chave** que aparecem no final.

Se o estúdio do Kaggle estiver desligado, o app usa o Hugging Face automaticamente.

## Estrutura

| Arquivo | O que faz |
|---|---|
| `server.js` | Servidor principal: letras, geração de música, biblioteca, cifra |
| `lyrics.js` | Compositor (prompts litúrgicos, textos do Missal, refinamento, cifra) |
| `kaggle.js` | Conexão com o seu estúdio ACE-Step 1.5 no Kaggle |
| `studio.js` | Separação de faixas (Demucs) e vídeo para Status (ffmpeg) |
| `audio.js` | Conversão WAV → MP3 e mixagem |
| `public/` | Interface do app (PWA instalável no celular e no PC) |
| `data/` | Músicas, faixas, vídeos e configurações (criado automaticamente) |
