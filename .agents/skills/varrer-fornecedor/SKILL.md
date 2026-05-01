---
name: varrer-fornecedor
description: Use esta skill sempre que precisar rodar, acessar ou resolver problemas na interface gráfica (Vite) do `fba-automation` no servidor (`srv-desktop`) através do notebook. Ela cobre Túnel SSH, portas 5173/8001/9222 e correção de Display (headless).
---

# Varrer Fornecedor (FBA Automation GUI)

Esta skill gerencia a operação remota da interface gráfica do sistema `fba-automation` hospedado no desktop do usuário, que funciona como servidor Ubuntu 24 (`srv-desktop`).

## 🚀 Como Iniciar o Sistema no Servidor

Tudo está hospedado no servidor Desktop (`bonette@srv-desktop`). Você inicia o acesso remoto através do comando `ssh openclaw-server`.

1.  Acesse o servidor: `ssh openclaw-server` (usuário `bonette`).
2.  Navegue até a pasta do projeto: `cd ~/Documentos/apps/fba-automation`
3.  Execute o script de inicialização: `bash iniciar_tudo.sh`
    -   *Nota:* O script ativa o Frontend (5173), Backend (8001) e Chrome Debug (9222).

## 🌉 Como Acessar pelo Notebook (Túnel SSH)

Para que a interface gráfica apareça no navegador do seu notebook, você deve abrir um **novo terminal local** (no notebook) e rodar o túnel:

```bash
ssh -L 5173:localhost:5173 -L 8001:localhost:8001 -L 9222:localhost:9222 bonette@192.168.0.173
```

-   **Link Direto no Notebook:** [http://localhost:5173/automation](http://localhost:5173/automation)
-   **Configuração Chrome CDP:** Deve estar como `http://127.0.0.1:9222` na interface gráfica.

## 🛠️ Troubleshooting (Correção de Erros)

### Erro: `Missing X server or $DISPLAY`
Ocorre quando o Chrome tenta abrir uma janela visual em um servidor sem monitor ou via SSH direto.
-   **Solução:** O arquivo `iniciar_tudo.sh` já foi corrigido para usar `--headless=new --disable-gpu`.

### Erro: `bind [::1]:5173: Cannot assign requested address`
Aviso comum no terminal do notebook ao abrir o Túnel.
-   **Significado:** O SSH tentou usar IPv6 e falhou, mas o IPv4 (padrão) funcionou. 
-   **Ação:** Pode ignorar o erro se o site abrir no Chrome.

## 🛠️ Regras de Ouro
-   **Hospedagem:** Sempre lembre que o processamento real ocorre no `srv-desktop`.
-   **Conexão:** O comando `ssh openclaw-server` é a porta de entrada para qualquer manutenção.
-   **Interface:** A visualização gráfica no notebook depende do Túnel SSH estar ativo.
