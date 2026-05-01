# Tutorial: Como ver a Interface do FBA Automation no seu Notebook

Este guia foi criado para você que quer rodar a automação no servidor, mas prefere controlar tudo e ver os logs por uma tela bonita no seu próprio notebook.

---

### 1. O que vamos fazer?
Como o seu servidor está longe, vamos criar um "Túnel" (uma ponte invisível). Isso vai pegar o site que está rodando lá no servidor e fazer ele aparecer no seu notebook como se estivesse instalado aqui.

### 2. Passo a Passo (Do começo ao fim)

#### **Etapa A: Abrir o terminal no seu Notebook**
1. Procure o aplicativo **Terminal** no seu notebook e abra ele.
2. Você vai precisar de **DUAS JANELAS** (ou abas) do terminal abertas.

#### **Etapa B: Iniciar o Sistema no Servidor (Janela 1)**
Nesta primeira janela, vamos ligar o motor do robô lá no servidor.
1. Digite o comando para entrar no servidor:
   ```bash
   ssh openclaw-server
   ```
2. Entre na pasta do programa:
   ```bash
   cd ~/Documentos/apps/fba-automation
   ```
3. Inicie o sistema:
   ```bash
   bash iniciar_tudo.sh
   ```
   **O que esperar:** Você verá várias mensagens com "✅" verde (Chrome Debug, Backend, Frontend). No final, o terminal ficará "parado" mostrando os logs. **Não feche esta janela!**

#### **Etapa C: Criar a "Ponte" (Janela 2)**
Agora, na **segunda janela** do terminal que você abriu:
1. Copie e cole este comando exatamente como está (ele cria a ponte para o site, para o robô e para o navegador):
   ```bash
   ssh -L 5173:localhost:5173 -L 8001:localhost:8001 -L 9222:localhost:9222 bonette@192.168.0.173
   ```
2. Coloque sua senha se for pedida.
3. **O que esperar:** Você estará logado no servidor normalmente. A partir de agora, a "ponte" está ativa. Pode minimizar essa janela, mas **não a feche**.

#### **Etapa D: Abrir o Site no seu Notebook**
Agora a parte fácil! 
1. Abra o **Google Chrome** no seu notebook.
2. Digite este endereço na barra de cima:
   **[http://localhost:5173/automation](http://localhost:5173/automation)**

---

### 3. Como usar a Interface (O que preencher)
Assim que o site abrir, você verá a tela preta com os botões.
*   **Controles de Execução (Lado Esquerdo):** Aqui você coloca o tamanho do lote, os preços e o índice de onde quer começar.
*   **Chrome CDP:** Já deve vir preenchido com `http://127.0.0.1:9222`. Como criamos a ponte no Passo C, isso vai funcionar perfeitamente!
*   **Botão AZUL (Começar / Reiniciar):** Clique aqui para dar o play na automação.
*   **Status ao Vivo (Lado Direito):** Você verá os logs subindo e qual fornecedor o robô está lendo no momento.

### 4. Resumo Rápido
1. **Janela 1:** `ssh` -> `cd` -> `bash iniciar_tudo.sh`
2. **Janela 2:** Comando `ssh -L ...` (A Ponte)
3. **Navegador:** Acessar `http://localhost:5173/automation`

### 5. Dicas de Ouro 💡
*   **Deu erro "Site não encontrado"?** Verifique se o comando da "Ponte" (Passo C) ainda está rodando. Se o terminal da Janela 2 fechar, o site para de funcionar.
*   **Quer parar tudo?** Vá na Janela 1 e aperte `Ctrl + C`. Isso vai encerrar o robô, o site e o navegador de forma segura.
*   **O agente 'varrer-fornecedores' foi excluído** conforme solicitado, para não gerar confusão com este novo software.

Aproveite sua nova interface! Qualquer dúvida, é só chamar.
