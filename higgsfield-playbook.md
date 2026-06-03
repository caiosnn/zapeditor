# Playbook Higgsfield — base de conhecimento do agente

> Este arquivo é injetado no prompt do agente a CADA mensagem. Editá-lo "treina" o bot na hora,
> sem reiniciar. Fontes: guias do Dan Kieft (Seedance 2.0), Steven Wommack (vídeo ultra-realista),
> Youri van Hofwegen (curta de IA) + templates de prompt. Acrescente seus aprendizados no fim.

---

## 0. PRINCÍPIO Nº1 — Planeje antes de gerar

Imagem é barata, vídeo é caro. Os profissionais **visualizam primeiro** (imagens) e só então geram vídeo.
- Pedido vago = "caça-níquel": o modelo escolhe tudo e erra → créditos desperdiçados. **Bad input = bad output.**
- Referência forte (imagem) **elimina a adivinhação** da IA → consistência e qualidade.
- Quando o pedido for ambíguo ou puder ficar muito melhor, **sugira** antes de gastar (especialmente vídeo).

---

## 1. Como o especialista trabalha

1. Entende o pedido (PT) e transforma num **prompt de geração em INGLÊS**, específico e rico.
2. Enriquece o vago sem contrariar a intenção. **Toda palavra precisa "ganhar seu lugar".**
3. Escolhe o modelo certo (seção 9), sugere, e respeita os padrões já definidos do chat.
4. Imagem gera direto; vídeo confirma custo antes.
5. Evita jargão vazio ("cinematic", "high quality") — usa **referências concretas** (câmera, lente, filme).

---

## 2. Catálogo de modelos

### Imagem (job_set_type)
| Quando usar | Modelo | job_set_type |
|---|---|---|
| **Padrão / melhor geral**: segue instrução, cena complexa, fotorrealismo | **Nano Banana Pro** | `nano_banana_2` |
| **Texto/tipografia na imagem**, briefing literal, **character sheets** | **GPT Image 2** | `gpt_image_2` |
| Fotorrealismo/estética premium, arte conceitual | FLUX.2 | `flux_2` |
| **Editar** imagem existente mantendo o contexto | Flux Kontext | `flux_kontext` |
| Foto **realista de pessoa** (UGC, influencer, lifestyle) | Higgsfield Soul V2 | `text2image_soul_v2` |
| Pessoa em clima cinematográfico / hiperrealista limpo | Soul Cinematic | `soul_cinematic` |
| Estética/design forte (pôster, editorial) | Seedream 4.5 | `seedream_v4_5` |
| Deixar a plataforma escolher o motor | Image Auto | `image_auto` |
| Remover fundo | Background Remover | `image_background_remover` |

Outros: `nano_banana_flash`, `nano_banana`, `grok_image`, `openai_hazel`, `seedream_v5_lite`, `z_image`, `kling_omni_image`, `cinematic_studio_2_5`, `soul_location`.

### Vídeo (job_set_type)
| Quando usar | Modelo | job_set_type |
|---|---|---|
| **Ação / movimento dinâmico**, físicas, efeito sonoro integrado | **Seedance 2.0** | `seedance_2_0` |
| **Cinema + áudio nativo** (diálogo, ambiente), tomada cinematográfica | **Veo 3.1** | `veo3_1` |
| **Image-to-video** expressivo, bom movimento | Kling 2.6 / 3.0 | `kling2_6` / `kling3_0` |
| Custo-benefício / dinâmica | Seedance 1.5 Pro | `seedance1_5` |
| Movimento natural, retrato | Minimax Hailuo | `minimax_hailuo` |
| Mais barato que o Veo 3.1 | Veo 3.1 Lite | `veo3_1_lite` |
| Reenquadrar (mudar proporção) | Reframe | `reframe` |
| Upscale de vídeo | Topaz | `topaz_video` |

Outros: `veo3`, `wan2_7`, `wan2_6`, `grok_video`, `soul_cast`, `draw_to_video`, `cinematic_studio_3_0/_video/_video_v2`, `sam_3_video`.

> Heurística (Dan Kieft): para **ação**, Seedance costuma bater o Veo. Para **diálogo/áudio/cinema**, Veo 3.1 brilha. Quando em dúvida, Seedance ou Kling para uso geral.

---

## 3. Anatomia de um bom prompt (em inglês)

Ordem recomendada para IMAGEM:
`[sujeito + descrição] + [ação/pose] + [ambiente] + [iluminação] + [estilo/estética] + [lente/câmera] + [qualidade]`

Para VÍDEO, pense em três blocos: **ESTILO + AÇÃO + CÂMERA** (e ÁUDIO se o modelo tiver som).

Regras de especificidade:
- Em vez de "cinematic", diga a câmera/lente/grade de cor: *"shot on ARRI Alexa, 35mm, Blade Runner 2049 color grade"* — o modelo reconhece referências de filmes/câmeras reais.
- Iluminação concreta: *"warm amber practicals", "high-contrast moody lighting", "golden hour", "neon reflections on wet asphalt"*.
- **1 ação por plano.** Nada de "ele corre, pula, saca a arma e atira" num shot só.

---

## 4. Frameworks de prompt (escolha conforme a cena)

### Framework A — Simples (ação única, rápido)
`[Estilo]. [Ação]. [Câmera].`
> Ex.: *"Gritty 35mm film, warm amber tones, heavy grain. A man in a leather jacket walks fast through a rain-soaked alley at night. Slow tracking shot from behind, shallow depth of field, waist height."*

### Framework B — Seedance 5 partes (vídeo com áudio)
`[Sujeito]. [Ação]. [Ambiente]. [Estilo]. [Áudio].`
> Ex.: *"A teenager in a bright neon jacket and vintage sneakers. Skateboarding fast past an old 80s mall. 1980s sunset street with parked cars, golden hour, heat shimmer off the asphalt. Extreme close-up tracking shot, handheld camcorder, fisheye lens, heavy 35mm grain. Skateboard wheels on pavement."*

### Framework C — Timeline (cena de 15s com vários planos, num prompt só)
Bloco de contexto no topo + lista de shots com timecode. Um Seedance de 15s aceita **até ~10 planos**.
```
STYLE: 3D animated feature film, warm sunny lighting, single shot feel.
CHARACTER: [descrição exaustiva — herda das prefs/refs].
LOCATION: [ambiente fixo].
CONTINUITY: same wardrobe; key light from the left; 180-degree rule.
0:00–0:03 WS, slow push-in. [uma ação].
0:03–0:07 MCU, locked. [uma ação]. "Curta fala aqui."
0:07–0:12 OTS, slow tracking. [uma ação].
0:12–0:15 CU, locked. [beat final].
AUDIO: ambient + sound events nos timecodes; música evolui.
```
Use timeline quando uma cena tem beats demais para um prompt simples.

> Para montar a partir de um storyboard: peça a um LLM "convert this 6-panel storyboard into a 15-second timeline prompt — timecodes, one action per shot, character and style block at top".

---

## 5. Linguagem de câmera

**Enquadramento:** ECU (detalhe/olhos) · CU (rosto) · MCU (cabeça+ombros, diálogo) · MS (cintura, ação) · WS (corpo inteiro/ambiente) · OTS (over-the-shoulder) · POV.
**Lentes:** 24–28mm (amplo/imersivo) · 35mm (documental) · 50mm (neutro) · 85mm (íntimo, DOF raso) · 100mm macro (textura).
**Movimento:** locked · slow push-in (escalada emocional) · slow pull-back (revelação) · tracking · arc/orbit · whip pan · handheld (urgência) · rack focus · crane.

Três níveis de dificuldade (peça assim no prompt de vídeo):
- **Nível 1 (fácil):** pan ou tracking acompanhando o sujeito. Ex.: *"a very slow steady cinematic pan from left to right, perfectly timed with his cross-screen movement."*
- **Nível 2:** tracking contínuo, 360/orbital. Diga "one continuous take, tracking shot".
- **Nível 3 (difícil):** POV extremo. Ex.: *"Extreme POV, high-speed first-person tracking that mimics natural head bobbing while walking quickly through a train station."*

Para um plano sem cortes, escreva explicitamente: **"single shot, one take, continuous shot, no cuts"** (senão o modelo corta sozinho).

---

## 6. Regra de ouro — respeite o relógio

- 5s = **um** beat. 10s = 2–3 beats. 15s = 3–4 beats (máx).
- O modelo resolve no máximo ~2–3 ações por segundo. Shot com 5 ações → glitch.
- **Diálogo:** ~2–3s por fala. Não enfie 3 falas em 2s. Na dúvida, **corte** a fala — silêncio + um rosto vale mais que um monólogo.
- A **duração** configurada no Higgsfield deve bater com o total dos timecodes do prompt.

---

## 7. Realismo (tirar o "cara de IA")

1. **Image-to-video**: gere uma imagem cinematográfica forte primeiro e anime-a (a qualidade do vídeo herda a da imagem).
2. **Textura sutil em pós**: film grain + bloom/halation muito leves quebram a "suavidade plástica". Exagero destrói o realismo. (Ferramenta de pós citada: Dehancer no Premiere/DaVinci.)
3. **Referência de rosto nítida e próxima** (textura de pele visível). Rosto distante → o modelo inventa feições. Para perfil/costas, forneça também foto lateral.
4. **Referências de filmes reais** dão alvo claro de cor/luz ("John Wick framing", "A24 restraint", "Ip Man restraint").
5. **POV de dispositivo** (celular/óculos/câmera de ação): combine o look real — iPhone selfie = tudo em foco, sem DOF raso, sem flare; Ray-Ban = sem fisheye, sem vinheta; câmera de ação = grande-angular, alto contraste. Áudio "captado pelo mic do device, levemente abafado".

---

## 8. Workflows avançados (para orquestrar em vários passos / sugerir ao usuário)

> O bot gera 1 mídia por vez, mas pode encadear ao longo da conversa (gera imagem → usa como referência no pedido seguinte). Sugira o passo a passo quando fizer sentido.

- **Character reference sheet** (consistência): GPT Image 2, *"Character design reference sheet of [pessoa]... showing front profile, side profile, and back. Clean white background."* (high, 2K, 16:9). Reuse como referência nas próximas gerações.
- **Start & End frame**: gere a imagem inicial e a final; o vídeo anima a transição. Bom para controle máximo. (O Higgsfield aceita start/end frame.)
- **Elements-to-video**: combine várias referências (personagem + ambiente + iluminação) numa cena. Para consistência fraca, **adicione mais referências** do personagem. Dica: alguns modelos metem música sozinhos → escreva **"no music"** se não quiser.
- **Storyboard**: gere um painel de 6 quadros (GPT Image 2) e depois anime a sequência com um prompt simples mantendo consistência ("maintain perfect character consistency, smooth 24 fps motion").
- **Continuidade entre clipes**: use o **clipe inteiro anterior como referência** do próximo (não só o último frame) — preserva mood/tensão em vez de resetar.
- **Restyle de estilo artístico** (a partir de um character sheet): *"Restyle this character design sheet. Apply the [STYLE] animation style. [detalhes]. White background."* Estilos: **Arcane** (oil paint, brush strokes, alto contraste), **Spider-Verse** (comic, halftone), **Claymation**, **PS1** (low-poly retrô), **1930s Rubber Hose** (P&B), **2D Disney**, **3D Pixar** (default).

---

## 9. Escolha de modelo por caso (resumo)

| Caso | Imagem | Vídeo |
|---|---|---|
| Pessoa realista / UGC | `text2image_soul_v2` / `soul_cinematic` | `seedance_2_0` ou `veo3_1` |
| Produto / e-commerce | `nano_banana_2` (4:5, fundo limpo) | `veo3_1` (push-in lento) |
| Ação / luta / esporte | `nano_banana_2` | `seedance_2_0` |
| Diálogo / fala / vlog | `gpt_image_2` (se tiver texto) | `veo3_1` |
| Texto/logo na imagem | `gpt_image_2` | — |
| Editar/variar uma imagem | `flux_kontext` | — |
| Arte estilizada / cartoon | `nano_banana_2` / `flux_2` | `seedance_2_0` |

---

## 10. Logic rules — prevenir falhas (adicione ao prompt)

- Duplicação: *"Only one [personagem] visible in frame at any time."*
- Personagens parecidos: *"[A] is visually distinct from [B] — different hair, build, face. No duplicates."*
- Guarda-roupa: *"Same wardrobe across all shots unless specified."*
- POV: *"POV — the camera IS the [device]. The device is never visible in frame."*
- Prop específico: *"The [item] is always the same. Only ONE visible at a time."* (ex.: "the selected card is always the ace of hearts").
- Sujeito que anda parando: *"Walks forward continuously for the full duration."*
- Plano contínuo: *"One continuous shot, no cuts, no camera-angle changes."*
- Trocar roupa sem nova referência: adicione ao fim *"But change his outfit to [...]"*.

---

## 11. Diálogo e áudio

- Diálogo **curto, quebrado, real** (contrações, hesitação), dentro do shot entre aspas: `MCU. "I'm not doing this again." He stands.`
- O modelo sincroniza o lip-sync ao texto do prompt.
- Áudio pré-gerado anexado: trate como `@audio` e **não** transcreva a letra — descreva a performance.
- Voz: clonar em ElevenLabs e dublar; música em Suno (cuidado: lip-sync pode travar em pausas vocais).
- Música: descreva a **evolução** ("sparse piano → strings no meio → cello stab na revelação"), não só "dramatic".

---

## 12. Economia de créditos

- Teste em **480p**; razoavelmente confiante, **720p**; só produção final em **1080p**. 1080p queima crédito rápido em iteração.
- **Visualize com imagem** (barato) antes de gastar em vídeo.
- Gere **múltiplos takes** e **costure os melhores trechos** — ninguém acerta de primeira; corte o pedaço ruim e regenere só ele.
- Para cenas de ação densas, gere **3 takes** e escolha o melhor.

---

## 13. Limitações conhecidas (Seedance/afins)

- **Máx ~3 personagens** por geração (acima disso, somem/trocam/duplicam).
- **Texto em vídeo** é fraco (pode sair invertido) — evite depender de texto na tela.
- **Detalhes minúsculos em janelas de 2–3s** não renderizam — simplifique shots curtos.
- **Gestos de mão complexos** podem falhar.
- Não diga "pitch black/black void" se ainda precisa ver algo — use "dim but visible".

---

## 14. Parâmetros do Higgsfield (CLI)

- **Imagem** (`nano_banana_2`): `aspect_ratio` (auto,1:1,3:2,2:3,4:3,3:4,4:5,5:4,9:16,16:9,21:9) · `resolution` (1k,2k,4k).
- **Vídeo** (`veo3_1`): `aspect_ratio` (16:9, 9:16) · `duration` (4,6,8) · `quality` (basic,high,ultra) · imagem de referência = primeiro frame (image-to-video).
- **Proporção por uso:** Reels/Stories/TikTok → 9:16 · YouTube/paisagem → 16:9 · Feed → 1:1 ou 4:5.
- **Defaults:** imagem `nano_banana_2` 2k; vídeo `veo3_1` 8s basic. Respeite padrões do chat.

---

## 15. Aprendizados (preencher com a prática)

<!-- Adicione fórmulas de prompt que funcionaram, combos modelo+params por tipo de resultado,
     preferências recorrentes do usuário, ajustes finos. Ex.:
     "Anúncio de produto estilo Apple: nano_banana_2, 4:5, fundo branco, 'soft studio lighting,
      single hero product, minimal shadows, 85mm, shallow DOF'." -->

- (vazio por enquanto)
