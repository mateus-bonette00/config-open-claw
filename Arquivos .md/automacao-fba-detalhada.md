# O Caminho do FBA (Servidor: bonette@srv-desktop)

Esta é a planta exata do fluxo funcionando dentro do seu servidor de produção, para não haver nenhuma dúvida de qual pasta enviar ou acessar.

## 1. Onde colocar o arquivo HTML? (A Entrada)
- Você baixa a lista de produtos do fornecedor (arquivo `.html`).
- Você acessa o seu servidor `bonette@srv-desktop` (via Cyberduck, WinSCP, Moba, ou terminal).
- Você solta esse arquivo ***exatamente*** na pasta raiz do projeto no servidor:
  👉 **`/home/bonette/openclaw-agents/`**

## 2. O Acionamento (O Gatilho)
- Você manda o comando `/fba` para a Zoe no WhatsApp.
- O script por trás da Zoe executa o arquivo Python oficial:
  👉 **`/home/bonette/openclaw-agents/agents/fba/fba_scraper.py`**
- O Python descobre automaticamente onde ele está e vasculha a pasta `/home/bonette/openclaw-agents/` procurando o seu arquivo `.html`.
- Ele abre o arquivo e copia os 4 pilares: Nome no Fornecedor, Nome na Amazon, Preço de Custo e Código ASIN.

## 3. A Transferência Segura (Movimentação)
- Assim que o Python puxa os dados, ele não deixa o `.html` na pasta principal.
- Ele envia esse arquivo ".html" para a pasta de arquivos lidos:
  👉 **`/home/bonette/openclaw-agents/Feitos/`**
- Motivo: Proteger o servidor de ler o mesmo lote amanhã. O que foi feito fica guardado na gaveta "Feitos".

## 4. O Cérebro: Avaliando e Filtrando
Enquanto o arquivo original já descansa na pasta `Feitos/`, o script segura os dados na memória e passa o facão:
- **Peneira 1:** Nome idêntico? Pelo menos 85% igual? Se não for, descarta na hora.
- **Peneira 2:** Qual o preço na Amazon? Ele tenta a API veloz do Keepa. Se a cota acabar (Erro 429), ele abre o navegador invisível Playwright ali mesmo no servidor, copia o preço e fecha.
- **Peneira 3:** Fechou a conta? Pega o Preço de Venda, subtrai 15% (Amazon), $4.00 (FBA cravado) e o Custo inicial.
- **Julgamento Final:** O Lucro que sobrou é **maior que $2.00** E o ROI é **maior que 10%**?
  - Se sim: Aprovado.
  - Se não: Descartado silenciosamente.

## 5. O Ouro: A Lista Final
- O robô separa os aprovados.
- Ele cria uma lista compacta (arquivo `.json`).
- Ele salva essa lista dourada dentro da pasta final:
  👉 **`/home/bonette/openclaw-agents/Lucrativos/`**

**E o log?**
Se você quiser ver o script "pensando" ou descobrir se deu algum erro de Digitação ou no Navegador invisível, você pode ler o log em:
👉 **`/home/bonette/openclaw-agents/storage/logs/fba.log`**

Pronto. Este é o fluxo exato operando hoje no usuário `bonette` do seu servidor matriz.
